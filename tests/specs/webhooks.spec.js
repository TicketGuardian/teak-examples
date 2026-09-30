// Tests for the webhooks example. The same tests run against every backend.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const SECRET = process.env.TEAK_WEBHOOK_SECRET || 'so-secret';

// A fixture event with a fresh policy or claim number, so tests don't see each other's events.
function fixture(name) {
  const event = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'events', `${name}.json`), 'utf8'));
  if (event.resource === 'Claim') event.data.claim_number = `clm_${crypto.randomUUID().slice(0, 8)}`;
  else event.data.policy_number = crypto.randomUUID();
  return event;
}

function sign(body, secret = SECRET) {
  return `sha256: ${crypto.createHmac('sha256', secret).update(body).digest('base64')}`;
}

async function deliver(request, event, { signature, raw } = {}) {
  const body = raw ?? JSON.stringify(event);
  return request.post('/webhooks/teak', {
    headers: { 'Content-Type': 'application/json', ...(signature !== null && { 'X-Protecht-Signature': signature ?? sign(body) }) },
    data: body,
  });
}

// Events are handled after the response, so poll until the example has processed this one.
async function logFor(request, key, count = 1) {
  let entries = [];
  await expect
    .poll(async () => {
      const { log } = await (await request.get('/api/events')).json();
      entries = log.filter((entry) => entry.key === key);
      return entries.length;
    })
    .toBeGreaterThanOrEqual(count);
  return entries;
}

test('accepts a correctly signed Contract Issued event and records the contract', async ({ request }) => {
  const event = fixture('contract-issued');
  expect((await deliver(request, event)).status()).toBe(200);

  const [entry] = await logFor(request, `Policy:Issued:${event.data.policy_number}`);
  expect(entry.outcome).toBe('contract issued');
  const { contracts } = await (await request.get('/api/events')).json();
  expect(contracts).toContainEqual({
    policyNumber: event.data.policy_number,
    orderNumber: 'ORD-1001',
    referenceNumber: 'ITEM-1',
    status: 'issued',
  });
});

test('refunds the premium on Contract Void, exactly as a decimal string', async ({ request }) => {
  const event = fixture('contract-void');
  expect((await deliver(request, event)).status()).toBe(200);

  const [entry] = await logFor(request, `Policy:Voided:${event.data.policy_number}`);
  expect(entry.outcome).toBe('contract voided, refunded 6.50 USD');
  const { refunds } = await (await request.get('/api/events')).json();
  expect(refunds).toContainEqual({ orderNumber: 'ORD-1001', referenceNumber: 'ITEM-1', amount: '6.50', currency: 'USD' });
});

test('handles a repeat delivery only once', async ({ request }) => {
  const event = fixture('contract-void');
  const body = JSON.stringify(event);
  expect((await deliver(request, event, { raw: body })).status()).toBe(200);
  expect((await deliver(request, event, { raw: body })).status()).toBe(200);

  const entries = await logFor(request, `Policy:Voided:${event.data.policy_number}`, 2);
  expect(entries.map((e) => e.outcome).sort()).toEqual(['contract voided, refunded 6.50 USD', 'duplicate, ignored']);
});

test('accepts refund request events', async ({ request }) => {
  const event = fixture('refund-request-created');
  expect((await deliver(request, event)).status()).toBe(200);
  const [entry] = await logFor(request, `Claim:Created:${event.data.claim_number}`);
  expect(entry.outcome).toBe(`refund request ${event.data.claim_number} Initiated`);
});

test('matches the documented signature test values', async ({ request }) => {
  // From https://docs.helloteak.com/docs/verifying-webhook-signatures#test-your-verification
  const body = '{"foo": "bar"}';
  expect(sign(body, 'so-secret')).toBe('sha256: 9gVpchQZGFoyjw+fuIl6ZgwR5vkOGuhc63yzDdD6cko=');
  if (SECRET === 'so-secret') {
    expect((await deliver(request, null, { raw: body })).status()).toBe(200);
  }
});

test.describe('rejects webhooks it cannot verify', () => {
  test('a wrong signature', async ({ request }) => {
    const res = await deliver(request, fixture('contract-issued'), { signature: sign('something else') });
    expect(res.status()).toBe(401);
  });

  test('a body changed after signing', async ({ request }) => {
    const event = fixture('contract-issued');
    const signature = sign(JSON.stringify(event));
    event.data.premium = '0.01';
    expect((await deliver(request, event, { signature })).status()).toBe(401);
  });

  test('a missing signature', async ({ request }) => {
    expect((await deliver(request, fixture('contract-issued'), { signature: null })).status()).toBe(401);
  });

  test('an unsigned subscription header, which holds a timestamp', async ({ request }) => {
    const res = await deliver(request, fixture('contract-issued'), { signature: 't: 1727539200' });
    expect(res.status()).toBe(401);
  });
});
