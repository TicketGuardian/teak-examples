// Server-to-server example, Node.js backend. Prices protection with Get programs, shows it in
// the store's own pages, and confirms the order with Teak. There's no Teak widget.
// https://docs.helloteak.com/docs/server-to-server-guide
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const crypto = require('crypto');
const express = require('express');
const { getPrograms, confirmTeakOrder, ConfirmNotSetUpError } = require('./teak');

// Whether the account's protection is optional (the customer accepts or declines it) or
// embedded (included in the ticket price). Your Teak integration contact tells you which.
const COVERAGE = process.env.TEAK_COVERAGE === 'embedded' ? 'embedded' : 'optional';

// What the store sells. Prices are set here on the server, never taken from the browser.
// Event times carry the event's own UTC offset. https://docs.helloteak.com/docs/server-offer#event-times
const EVENTS = [
  { id: 'summer-fest', name: 'Summer Fest - General Admission', eventName: 'Summer Fest', venue: 'Austin, TX', productType: 'general-admission', price: '57.50', startsAt: '2026-07-18T19:00:00-05:00', endsAt: '2026-07-18T23:00:00-05:00' },
  { id: 'summer-fest-vip', name: 'Summer Fest - VIP', eventName: 'Summer Fest', venue: 'Austin, TX', productType: 'general-admission', price: '149.00', startsAt: '2026-07-18T19:00:00-05:00', endsAt: '2026-07-18T23:00:00-05:00' },
  { id: 'jazz-night', name: 'Jazz Night - Balcony', eventName: 'Jazz Night', venue: 'New York, NY', productType: 'general-admission', price: '85.00', startsAt: '2026-08-07T20:00:00-04:00', endsAt: '2026-08-07T23:00:00-04:00' },
];

// A session lasts 2 hours after the last Get programs call, and 24 hours at most.
// An expired session can't be revived. https://docs.helloteak.com/docs/sessions
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;

// Carts and orders are kept in memory. Use your database.
const carts = new Map(); // cart ID -> { session, location, lines, teakItems, protectionTotal }
const orders = new Map();

const cents = (amount) => Math.round(Number(amount) * 100);
const dollars = (amountInCents) => (amountInCents / 100).toFixed(2);

function getCart(cartId) {
  if (cartId && carts.has(cartId)) return carts.get(cartId);
  const cart = { id: crypto.randomUUID(), session: null };
  carts.set(cart.id, cart);
  return cart;
}

// The cart's Teak session, or null if there's none or it has expired.
function liveSessionId(cart) {
  const session = cart.session;
  if (!session) return null;
  const now = Date.now();
  if (now - session.lastCallAt > SESSION_IDLE_MS || now - session.startedAt > SESSION_MAX_MS) {
    cart.session = null; // start a new one, and show the new prices
    return null;
  }
  return session.id;
}

function rememberSession(cart, sessionId) {
  const now = Date.now();
  if (cart.session?.id === sessionId) cart.session.lastCallAt = now;
  else cart.session = { id: sessionId, startedAt: now, lastCallAt: now };
}

// Where the customer is, as ISO country and region codes. Use their billing address, or the
// country and region you already know. https://docs.helloteak.com/docs/server-offer#send-the-customers-location
function readLocation(location) {
  const country = String(location?.country || '').toUpperCase();
  const region = String(location?.region || '').toUpperCase();
  return /^[A-Z]{2}$/.test(country) && /^[A-Z0-9]{1,3}$/.test(region) ? { country, region } : null;
}

function toTeakItem(event, referenceId) {
  return {
    name: event.name,
    reference_id: referenceId,
    product_types: [event.productType],
    cost: event.price, // a string, including the item's share of taxes and fees
    event: { name: event.eventName, start_datetime: event.startsAt, end_datetime: event.endsAt },
  };
}

// Prices items on the cart's session. Returns Teak's prices by reference ID, or null if the
// call failed or timed out: the page then shows without protection.
async function priceItems(cart, location, items) {
  try {
    const programs = await getPrograms({ sessionId: liveSessionId(cart), location, items });
    rememberSession(cart, programs.session_id);
    return new Map(programs.items.map((item) => [item.reference_id, item]));
  } catch (err) {
    console.warn(`Cart ${cart.id}: ${err.message}`); // log it, so you can fix the item it names
    return null;
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'] }));

app.get('/health', (req, res) => res.send('ok'));

// Search results, each with its protection price. One call prices the whole page.
app.post('/api/search', async (req, res) => {
  const location = readLocation(req.body?.location);
  if (!location) return res.status(400).json({ error: 'Choose where you are.' });
  const cart = getCart(req.body?.cartId);

  const prices = await priceItems(cart, location, EVENTS.map((event) => toTeakItem(event, event.id)));
  res.json({
    cartId: cart.id,
    coverage: COVERAGE,
    results: EVENTS.map(({ id, name, venue, price, startsAt }) => ({
      id, name, venue, price, startsAt,
      protectionPrice: prices?.get(id)?.estimated_premium ?? null,
    })),
  });
});

// The cart, priced again on the same session. One Teak item per ticket.
app.post('/api/cart', async (req, res) => {
  const location = readLocation(req.body?.location);
  const cart = carts.get(req.body?.cartId);
  if (!location || !cart) return res.status(400).json({ error: 'Start from the search page.' });

  const quantities = req.body?.quantities ?? {};
  const lines = EVENTS.map((event) => ({ event, quantity: quantities[event.id] }))
    .filter(({ quantity }) => Number.isInteger(quantity) && quantity > 0 && quantity <= 10);
  if (lines.length === 0) return res.status(400).json({ error: 'Add a ticket.' });

  const teakItems = lines.flatMap(({ event, quantity }) =>
    Array.from({ length: quantity }, (_, i) => toTeakItem(event, `${event.id}-${i + 1}`))
  );
  const prices = await priceItems(cart, location, teakItems);
  const protectionCents = prices ? teakItems.reduce((sum, item) => sum + cents(prices.get(item.reference_id)?.estimated_premium ?? 0), 0) : 0;

  Object.assign(cart, {
    location,
    lines: lines.map(({ event, quantity }) => ({ id: event.id, name: event.name, price: event.price, quantity })),
    teakItems: prices ? teakItems.map((item) => item.reference_id) : [],
    protectionTotal: prices && protectionCents > 0 ? dollars(protectionCents) : null,
  });
  res.json({
    coverage: COVERAGE,
    lines: cart.lines,
    subtotal: dollars(cart.lines.reduce((sum, line) => sum + cents(line.price) * line.quantity, 0)),
    protectionTotal: cart.protectionTotal,
  });
});

app.post('/api/checkout', (req, res) => {
  const { cartId, accepted, customer = {} } = req.body ?? {};
  const cart = carts.get(cartId);
  if (!cart?.lines || !customer.first_name || !customer.last_name || !customer.email) {
    return res.status(400).json({ error: 'Add a ticket and fill in your details.' });
  }
  const offered = Boolean(cart.protectionTotal);
  const protectedOrder = offered && (COVERAGE === 'embedded' || accepted === true);

  // Create and charge the order in your system first. This example only records it.
  const order = {
    number: `ORD-${Date.now()}-${crypto.randomInt(1000, 10000)}`,
    lines: cart.lines,
    customer: { first_name: customer.first_name, last_name: customer.last_name, email: customer.email },
    protectionPrice: protectedOrder ? cart.protectionTotal : null,
    protection: offered ? 'pending' : 'not-offered',
  };
  orders.set(order.number, order);
  const sessionId = liveSessionId(cart);
  const choices = COVERAGE === 'optional' ? cart.teakItems.map((referenceId) => ({ referenceId, accepted: accepted === true })) : [];

  // A session covers one purchase. Start the next one fresh, whatever Teak responds.
  carts.delete(cart.id);
  res.json({ orderNumber: order.number });

  // The customer's order is complete. Confirm it with Teak in the background, so retries never
  // hold up checkout, and a Teak failure never fails the order.
  if (!offered || !sessionId) return;
  confirmTeakOrder({ sessionId, choices, order })
    .then((result) => {
      order.protection = result;
    })
    .catch((err) => {
      order.protection = err instanceof ConfirmNotSetUpError ? 'not-set-up' : 'failed';
      console.error(`Order ${order.number}: ${err.message}`); // alert your team
    });
});

app.get('/api/orders/:number', (req, res) => {
  const order = orders.get(req.params.number);
  if (!order) return res.sendStatus(404);
  res.json({ orderNumber: order.number, protection: order.protection, protectionPrice: order.protectionPrice });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Server-to-server example (Node.js) on http://localhost:${port}`);
  if (!process.env.TEAK_PUBLIC_KEY || !process.env.TEAK_SECRET_KEY) {
    console.warn('Set TEAK_PUBLIC_KEY and TEAK_SECRET_KEY in .env. See .env.example.');
  }
});
