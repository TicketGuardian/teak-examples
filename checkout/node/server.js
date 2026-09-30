// Checkout example, Node.js backend. Serves the shared frontend and submits orders to Teak.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const crypto = require('crypto');
const express = require('express');
const { submitTeakOrder, getProtectionLinks } = require('./teak');

// What the store sells. Prices are set here on the server, never taken from the browser.
const EVENT = {
  name: 'Summer Fest',
  location: 'Austin, TX',
  startDatetime: '2026-07-18T18:00:00-05:00',
  endDatetime: '2026-07-18T23:00:00-05:00',
};
const CATALOG = [
  { id: 'ga', name: 'Summer Fest - General Admission', price: 120, event: EVENT },
  { id: 'vip', name: 'Summer Fest - VIP', price: 280, event: EVENT },
];

// Orders are kept in memory. Use your database.
const orders = new Map();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'] }));

app.get('/health', (req, res) => res.send('ok'));

app.get('/api/config', (req, res) => {
  res.json({ publicKey: process.env.TEAK_PUBLIC_KEY || null, catalog: CATALOG });
});

app.post('/api/checkout', (req, res) => {
  const { cart, customer = {}, teakSessionId, protectionPrice } = req.body ?? {};
  const lines = (Array.isArray(cart) ? cart : [])
    .map(({ id, quantity }) => ({ product: CATALOG.find((p) => p.id === id), quantity }))
    .filter(({ product, quantity }) => product && Number.isInteger(quantity) && quantity > 0 && quantity <= 10)
    .map(({ product, quantity }) => ({ id: product.id, name: product.name, price: product.price, quantity }));
  if (lines.length === 0 || !customer.first_name || !customer.last_name || !customer.email) {
    return res.status(400).json({ error: 'Add a ticket and fill in your details.' });
  }

  // Create and charge the order in your system first. This example only records it.
  const order = {
    number: `ORD-${Date.now()}-${crypto.randomInt(1000, 10000)}`,
    lines,
    customer: { first_name: customer.first_name, last_name: customer.last_name, email: customer.email },
    protectionPrice: protectionPrice || null,
    protection: teakSessionId ? 'pending' : 'not-offered',
    links: null,
  };
  orders.set(order.number, order);
  res.json({ orderNumber: order.number });

  // The customer's order is complete. Submit it to Teak in the background, so retries never
  // hold up checkout, and a Teak failure never fails the order.
  if (!teakSessionId) return;
  submitTeakOrder(teakSessionId, order)
    .then((result) => {
      order.protection = result;
    })
    .catch((err) => {
      order.protection = 'failed';
      console.error(`Order ${order.number}:`, err.message); // alert your team
    });
});

app.get('/api/orders/:number', async (req, res) => {
  const order = orders.get(req.params.number);
  if (!order) return res.sendStatus(404);

  // Links are available once Teak has created the order, a few seconds after Submit.
  if (order.protection === 'submitted' && !order.links) {
    order.links = await getProtectionLinks(order.number, order.customer.email).catch((err) => {
      console.error(`Order ${order.number}:`, err.message);
      return null;
    });
  }
  res.json({ orderNumber: order.number, protection: order.protection, links: order.links });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Checkout example (Node.js) on http://localhost:${port}`);
  if (!process.env.TEAK_PUBLIC_KEY || !process.env.TEAK_SECRET_KEY) {
    console.warn('Set TEAK_PUBLIC_KEY and TEAK_SECRET_KEY in .env. See .env.example.');
  }
});
