// Webhooks example, Node.js. Verifies each webhook's signature, responds straight away,
// then handles the event: records issued contracts and refunds voided ones.
// https://docs.helloteak.com/docs/receiving-webhooks
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const crypto = require('crypto');
const express = require('express');

// Kept in memory. Use your database.
const contracts = new Map(); // policy_number -> contract
const refunds = []; // refunds you'd send to your payment provider
const log = []; // every delivery and what happened to it, newest first
const processed = new Set(); // event identities already handled

// From the "Verify a webhook signature" recipe.
// https://docs.helloteak.com/docs/verifying-webhook-signatures
function verifyTeakSignature(rawBody, header, secret) {
  if (!secret || !header || !header.startsWith('sha256:')) return false;
  const received = Buffer.from(header.slice('sha256:'.length).trim(), 'base64');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

// Events have no ID, and Teak can deliver one more than once. These fields identify an event.
function eventKey(event) {
  const id = event.resource === 'Claim' ? event.data?.claim_number : event.data?.policy_number;
  return `${event.resource}:${event.action}:${id}`;
}

function handleTeakEvent(event) {
  const key = eventKey(event);
  if (processed.has(key)) {
    log.unshift({ key, outcome: 'duplicate, ignored' });
    return;
  }

  const data = event.data ?? {};
  let outcome = 'ignored';
  if (event.resource === 'Policy') {
    // A contract event: one per protected item. https://docs.helloteak.com/docs/contract-events
    contracts.set(data.policy_number, {
      policyNumber: data.policy_number,
      orderNumber: data.order_number, // the reference_id you submitted
      referenceNumber: data.reference_number, // the item's referenceNumber from the widget
      status: data.status,
    });
    outcome = `contract ${data.status}`;

    if (event.action === 'Voided') {
      // You collected the protection price at checkout, so refund it. premium is a decimal
      // string: pass it to your payment provider as a decimal, not a float.
      refunds.push({ orderNumber: data.order_number, referenceNumber: data.reference_number, amount: data.premium, currency: data.currency });
      outcome = `contract voided, refunded ${data.premium} ${data.currency}`;
    }
  } else if (event.resource === 'Claim') {
    // A refund request event. https://docs.helloteak.com/docs/refund-request-events
    outcome = `refund request ${data.claim_number} ${data.status}`;
  }

  processed.add(key);
  log.unshift({ key, outcome });
  console.log(`${key}: ${outcome}`);
}

const app = express();

app.get('/health', (req, res) => res.send('ok'));

// express.raw keeps the body as bytes, so the signature is checked against exactly what was sent.
app.post('/webhooks/teak', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); // empty if not sent as JSON
  if (!verifyTeakSignature(rawBody, req.get('X-Protecht-Signature'), process.env.TEAK_WEBHOOK_SECRET)) {
    return res.sendStatus(401);
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.sendStatus(400);
  }
  if (!event || typeof event !== 'object') return res.sendStatus(400);

  // Respond within 10 seconds, then do the work. In production, put the event on a queue.
  res.sendStatus(200);
  setImmediate(() => handleTeakEvent(event));
});

// What the example has received, for trying it out. Don't expose this in production.
app.get('/api/events', (req, res) => {
  res.json({ log, contracts: [...contracts.values()], refunds });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Webhooks example (Node.js) on http://localhost:${port}/webhooks/teak`);
  if (!process.env.TEAK_WEBHOOK_SECRET) {
    console.warn('Set TEAK_WEBHOOK_SECRET in .env. Until you do, every webhook is rejected with 401.');
  }
});
