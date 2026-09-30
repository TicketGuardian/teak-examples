#!/usr/bin/env node
// Send a signed test webhook to a webhooks example, the way Teak signs real ones.
//
//   node scripts/send-test-webhook.mjs contract-issued
//   node scripts/send-test-webhook.mjs contract-void http://localhost:8090/webhooks/teak
//
// Events are in tests/fixtures/events. The secret comes from TEAK_WEBHOOK_SECRET, in the
// environment or in .env. Needs Node.js 20 or later.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const eventsDir = path.join(root, 'tests', 'fixtures', 'events');
const [name, url = 'http://localhost:8080/webhooks/teak'] = process.argv.slice(2);
const available = fs.readdirSync(eventsDir).map((f) => f.replace(/\.json$/, ''));

if (!name || !available.includes(name)) {
  console.error(`Usage: node scripts/send-test-webhook.mjs <event> [url]\nEvents: ${available.join(', ')}`);
  process.exit(1);
}

function readSecret() {
  if (process.env.TEAK_WEBHOOK_SECRET) return process.env.TEAK_WEBHOOK_SECRET;
  const envFile = path.join(root, '.env');
  if (!fs.existsSync(envFile)) return null;
  const line = fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('TEAK_WEBHOOK_SECRET='));
  return line ? line.slice('TEAK_WEBHOOK_SECRET='.length).trim() : null;
}

const secret = readSecret();
if (!secret) {
  console.error('Set TEAK_WEBHOOK_SECRET in .env or the environment.');
  process.exit(1);
}

// The signature is a base64 HMAC-SHA256 of the raw body, keyed with the subscription's secret.
const body = fs.readFileSync(path.join(eventsDir, `${name}.json`), 'utf8');
const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Protecht-Signature': `sha256: ${signature}` },
  body,
});
console.log(`${name} -> ${url}: ${res.status}`);
process.exit(res.ok ? 0 : 1);
