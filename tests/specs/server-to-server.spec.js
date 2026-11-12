// Tests for the server-to-server example. The same tests run against every backend, with the mock
// Teak API in place of the real one (see docker-compose.test.yml). The mock prices each item at 8%
// of its cost, and a location region of "ZZ" makes the Programs API fail.
// Confirm the order is set up with each partner's Teak integration contact, so the example ships
// without it: these tests check that an order still completes, and reports that it isn't set up.
const { test, expect } = require('@playwright/test');

const TX = { country: 'US', region: 'TX' };
const CUSTOMER = { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' };

async function search(request, body) {
  const res = await request.post('/api/search', { data: body });
  expect(res.status()).toBe(200);
  return res.json();
}

async function priceCart(request, cartId, quantities, location = TX) {
  const res = await request.post('/api/cart', { data: { cartId, location, quantities } });
  expect(res.status()).toBe(200);
  return res.json();
}

// Confirming runs in the background, so poll the order until it settles.
async function settledOrder(request, orderNumber) {
  let order;
  await expect
    .poll(async () => {
      order = await (await request.get(`/api/orders/${orderNumber}`)).json();
      return order.protection !== 'pending';
    }, { timeout: 20_000 })
    .toBe(true);
  return order;
}

test.describe('API', () => {
  test('prices every search result in one call', async ({ request }) => {
    const { cartId, results } = await search(request, { location: TX });
    expect(cartId).toBeTruthy();
    expect(results.map((r) => r.id)).toEqual(['summer-fest', 'summer-fest-vip', 'jazz-night']);
    expect(results.map((r) => r.protectionPrice)).toEqual(['4.60', '11.92', '6.80']);
    for (const result of results) {
      expect(result.startsAt).toMatch(/[+-]\d{2}:\d{2}$/); // event times keep their UTC offset
    }
  });

  test('shows results without prices when the Programs API fails', async ({ request }) => {
    const { results } = await search(request, { location: { country: 'US', region: 'ZZ' } });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.protectionPrice === null)).toBe(true);
  });

  test('rejects a search without a location', async ({ request }) => {
    const res = await request.post('/api/search', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('prices the cart on the same session, one item per ticket', async ({ request }) => {
    const { cartId } = await search(request, { location: TX });
    const cart = await priceCart(request, cartId, { 'summer-fest': 2, 'jazz-night': 1 });
    expect(cart.subtotal).toBe('200.00');
    expect(cart.protectionTotal).toBe('16.00'); // 4.60 + 4.60 + 6.80
    expect(cart.lines).toEqual([
      expect.objectContaining({ id: 'summer-fest', quantity: 2 }),
      expect.objectContaining({ id: 'jazz-night', quantity: 1 }),
    ]);
  });

  test('rejects an empty cart', async ({ request }) => {
    const { cartId } = await search(request, { location: TX });
    const res = await request.post('/api/cart', { data: { cartId, location: TX, quantities: {} } });
    expect(res.status()).toBe(400);
  });

  test('completes the order even though Confirm the order is not set up', async ({ request }) => {
    const { cartId } = await search(request, { location: TX });
    await priceCart(request, cartId, { 'summer-fest': 1 });
    const res = await request.post('/api/checkout', { data: { cartId, accepted: true, customer: CUSTOMER } });
    expect(res.status()).toBe(200);
    const { orderNumber } = await res.json();
    expect(orderNumber).toMatch(/^ORD-/);

    const order = await settledOrder(request, orderNumber);
    expect(order.protection).toBe('not-set-up');
    expect(order.protectionPrice).toBe('4.60');
  });

  test('records no protection price when the customer declines', async ({ request }) => {
    const { cartId } = await search(request, { location: TX });
    await priceCart(request, cartId, { 'summer-fest': 1 });
    const { orderNumber } = await (await request.post('/api/checkout', { data: { cartId, accepted: false, customer: CUSTOMER } })).json();
    const order = await settledOrder(request, orderNumber);
    expect(order.protectionPrice).toBeNull();
  });

  test('starts a new session after the order is placed', async ({ request }) => {
    const { cartId } = await search(request, { location: TX });
    await priceCart(request, cartId, { 'summer-fest': 1 });
    await request.post('/api/checkout', { data: { cartId, accepted: true, customer: CUSTOMER } });

    // The cart, and its session, are gone. The next search starts a new cart.
    const next = await search(request, { cartId, location: TX });
    expect(next.cartId).not.toBe(cartId);
  });

  test('marks an order without a price as not offered', async ({ request }) => {
    const { cartId } = await search(request, { location: { country: 'US', region: 'ZZ' } });
    const cart = await priceCart(request, cartId, { 'summer-fest': 1 }, { country: 'US', region: 'ZZ' });
    expect(cart.protectionTotal).toBeNull();
    const { orderNumber } = await (await request.post('/api/checkout', { data: { cartId, accepted: true, customer: CUSTOMER } })).json();
    const order = await (await request.get(`/api/orders/${orderNumber}`)).json();
    expect(order.protection).toBe('not-offered');
  });
});

test.describe('Pages', () => {
  test('shows a protection price on each search result', async ({ page }) => {
    await page.goto('/');
    const prices = page.getByTestId('protection-price');
    await expect(prices).toHaveCount(3);
    await expect(prices.first()).toHaveText('Refund protection available: $4.60');
  });

  test('adds protection to the total only when the customer accepts it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('protection-price')).toHaveCount(3);
    await page.getByRole('button', { name: 'Add one' }).first().click();
    await page.getByRole('button', { name: 'Go to checkout' }).click();

    await expect(page.locator('#total')).toHaveText('$57.50');
    await page.getByLabel(/Add refund protection for \$4\.60/).check();
    await expect(page.locator('#protection')).toHaveText('$4.60');
    await expect(page.locator('#total')).toHaveText('$62.10');
    await page.getByLabel(/Add refund protection/).uncheck();
    await expect(page.locator('#total')).toHaveText('$57.50');
  });

  test('places the order and shows the confirmation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('protection-price')).toHaveCount(3);
    await page.getByRole('button', { name: 'Add one' }).first().click();
    await page.getByRole('button', { name: 'Go to checkout' }).click();
    await page.getByLabel(/Add refund protection/).check();
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page).toHaveURL(/\/confirmation\?order=ORD-/);
    await expect(page.locator('#protection-status')).toHaveAttribute('data-status', 'not-set-up');
  });
});
