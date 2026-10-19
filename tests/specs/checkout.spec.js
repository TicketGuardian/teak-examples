// Tests for the checkout example. The same tests run against every backend, with the mock
// Teak API in place of the real one (see docker-compose.test.yml).
// The browser tests swap teak.js for a stand-in widget (fixtures/fake-teak.js), so they check
// this example's own code: the cart, the totals, placing the order, and the confirmation page.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const FAKE_TEAK = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fake-teak.js'), 'utf8');
const CUSTOMER = { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' };

async function openCheckout(page, sessionPrefix = 'sess-') {
  await page.addInitScript((prefix) => (window.__teakSessionPrefix = prefix), sessionPrefix);
  await page.route('https://icw.helloteak.com/teak.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_TEAK })
  );
  await page.goto('/');
  await expect(page.getByTestId('fake-teak')).toBeVisible();
}

async function checkout(request, teakSessionId) {
  const res = await request.post('/api/checkout', {
    data: { cart: [{ id: 'ga', quantity: 2 }], customer: CUSTOMER, teakSessionId, protectionPrice: '6.50' },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).orderNumber;
}

// Submit runs in the background, so poll the order until it settles.
async function settledOrder(request, orderNumber, until = (order) => order.protection !== 'pending') {
  let order;
  await expect
    .poll(async () => {
      order = await (await request.get(`/api/orders/${orderNumber}`)).json();
      return until(order);
    }, { timeout: 20_000 })
    .toBe(true);
  return order;
}

test.describe('API', () => {
  test('serves the public key and catalog', async ({ request }) => {
    const config = await (await request.get('/api/config')).json();
    expect(config.publicKey).toBeTruthy();
    expect(config.catalog.map((p) => p.id)).toEqual(['ga', 'vip']);
    for (const product of config.catalog) {
      expect(product.event.location).toBeTruthy(); // required by the widget
    }
  });

  test('submits an opted-in order and returns its protection links', async ({ request }) => {
    const orderNumber = await checkout(request, `sess-${Date.now()}`);
    expect(orderNumber).toMatch(/^ORD-/);
    const order = await settledOrder(request, orderNumber, (o) => Boolean(o.links));
    expect(order.protection).toBe('submitted');
    expect(order.links[0]).toMatchObject({ product: 'refund-protection', cancel: null });
    expect(order.links[0].certificate).toMatch(/^https:\/\//);
  });

  test('records an opt-out when Submit returns 204', async ({ request }) => {
    const order = await settledOrder(request, await checkout(request, `optout-${Date.now()}`));
    expect(order.protection).toBe('opted-out');
    expect(order.links).toBeNull();
  });

  test('retries when Teak is temporarily unavailable', async ({ request }) => {
    const order = await settledOrder(request, await checkout(request, `flaky-${Date.now()}`));
    expect(order.protection).toBe('submitted');
  });

  test('completes the order without protection when the widget never loaded', async ({ request }) => {
    const order = await settledOrder(request, await checkout(request, null));
    expect(order.protection).toBe('not-offered');
  });

  test('rejects an empty cart or missing details', async ({ request }) => {
    const empty = await request.post('/api/checkout', { data: { cart: [], customer: CUSTOMER } });
    expect(empty.status()).toBe(400);
    const noEmail = await request.post('/api/checkout', {
      data: { cart: [{ id: 'ga', quantity: 1 }], customer: { first_name: 'Ada', last_name: 'Lovelace' } },
    });
    expect(noEmail.status()).toBe(400);
  });

  test('ignores products and quantities it does not sell', async ({ request }) => {
    const res = await request.post('/api/checkout', {
      data: { cart: [{ id: 'backstage', quantity: 1 }, { id: 'ga', quantity: 99 }], customer: CUSTOMER },
    });
    expect(res.status()).toBe(400);
  });

  test('returns 404 for an unknown order', async ({ request }) => {
    expect((await request.get('/api/orders/ORD-unknown')).status()).toBe(404);
  });
});

test.describe('Browser', () => {
  test('adds the protection price when the customer opts in, and removes it on opt-out', async ({ page }) => {
    await openCheckout(page);
    await expect(page.locator('#subtotal')).toHaveText('$240.00');

    await page.getByTestId('teak-opt-in').click();
    await expect(page.locator('#protection')).toHaveText('$6.50'); // two tickets at 3.25 each
    await expect(page.locator('#total')).toHaveText('$246.50');

    await page.getByTestId('teak-opt-out').click();
    await expect(page.locator('#protection-row')).toBeHidden();
    await expect(page.locator('#total')).toHaveText('$240.00');
  });

  test('re-prices protection when the cart changes', async ({ page }) => {
    await openCheckout(page);
    await page.getByTestId('teak-opt-in').click();
    await page.locator('.cart-line').first().getByLabel('Add one').click();
    await expect(page.locator('#subtotal')).toHaveText('$360.00');
    await expect(page.locator('#protection')).toHaveText('$9.75'); // three tickets
  });

  test('places the order and shows the protection links', async ({ page }) => {
    await openCheckout(page);
    await page.getByTestId('teak-opt-in').click();
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page).toHaveURL(/\/confirmation\?order=ORD-/);
    await expect(page.locator('#protection-status')).toHaveAttribute('data-status', 'issued', { timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'View your certificate' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cancel your protection' })).toHaveCount(0);
  });

  test('confirms an opted-out order', async ({ page }) => {
    await openCheckout(page, 'optout-');
    await page.getByTestId('teak-opt-out').click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.locator('#protection-status')).toHaveAttribute('data-status', 'opted-out', { timeout: 20_000 });
  });

  test('still takes the order when the widget script fails to load', async ({ page }) => {
    await page.route('https://icw.helloteak.com/teak.js', (route) => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.locator('#protection-status')).toHaveAttribute('data-status', 'not-offered', { timeout: 20_000 });
  });
});
