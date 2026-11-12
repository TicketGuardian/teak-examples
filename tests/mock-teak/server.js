// A stand-in for the Teak Partner API, so the examples can be tested without sandbox keys.
// It covers only the calls the examples make, with the same shapes as the real API.
// Special session IDs trigger other outcomes:
//   optout-...   Submit returns 204, as when the customer didn't opt in
//   flaky-...    Submit fails once with error.code 503, then succeeds
//   dup-...      Submit finds the order already submitted, as if an earlier attempt's response was lost
// Submitting a session twice returns HTTP 409 with "status": "already_submitted", as the real API does.
// Order details return 404 for 1 second after Submit, while the order is "being created".
// The Programs API prices each item at 8% of its cost. These trigger its errors, as the real API does:
//   a product type of "unmapped"   422 for the whole call, naming the item
//   a location region of "ZZ"      422, the location can't be resolved
//   an unknown session_id          422
const http = require('http');
const crypto = require('crypto');

const TOKEN = 'mock-access-token';
const sessions = new Map(); // session ID -> { referenceId, email, submittedAt }
const flakyAttempts = new Map();
const programSessions = new Set(); // session IDs started by the Programs API

function send(res, status, body) {
  res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function envelope(code, message) {
  return { apiVersion: '2.0', error: { code, message: 'invalid data. see errors for more information.', errors: [{ domain: 'Order', reason: 'VALIDATION_ERROR', message }] } };
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const authorized = req.headers.authorization === `Bearer ${TOKEN}`;

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  if (req.method === 'POST' && url.pathname === '/v1/auth/token') {
    const body = await readJson(req);
    if (!body?.public_key || !body?.secret_key) {
      return send(res, 400, { non_field_errors: ['Unable to log in with provided credentials.'] });
    }
    return send(res, 200, { token: TOKEN });
  }

  if (req.method === 'POST' && url.pathname === '/v1/programs') {
    if (!authorized) return send(res, 401, envelope(401, 'User session has expired or is invalid.Please try again.'));
    const body = await readJson(req);
    const field = (loc, msg) => send(res, 422, [{ type: 'Validation Error', loc: ['body', 'data', ...loc], msg }]);
    if (!body?.currency || !body?.locale) return field(['currency'], 'Field required');
    if (!body.location || !(body.location.country || body.location.ip_address || body.location.phone_number)) {
      return field(['location'], 'Value error, location needs at least one of country, ip_address, or phone_number');
    }
    if (!Array.isArray(body.items) || body.items.length === 0) return field(['items'], 'Field required');
    for (const [i, item] of body.items.entries()) {
      if (typeof item.cost !== 'string') return field(['items', i, 'cost'], 'Value error, cost must be a string. Numeric types (int, float) are not accepted.');
      if (!item.name || !item.reference_id || !Array.isArray(item.product_types) || !item.event?.name) return field(['items', i], 'Field required');
    }
    if (body.location.region === 'ZZ') {
      return send(res, 422, { msg: 'Could not resolve traveler location (country_region=unknown_region, ip_address=missing, phone_number=missing)', type: 'Validation Error' });
    }
    const unmapped = body.items.find((item) => item.product_types.includes('unmapped'));
    if (unmapped) return send(res, 422, { msg: `Unknown product type for items: '${unmapped.reference_id}' (unmapped)`, type: 'Unprocessable Entity' });
    if (body.session_id !== undefined && !programSessions.has(body.session_id)) {
      return field(['session_id'], 'Value error, unknown session_id');
    }

    const sessionId = body.session_id ?? crypto.randomUUID();
    programSessions.add(sessionId);
    const priced = body.items.filter((item) => Number(item.cost) > 0); // items that cost 0 are left out
    return send(res, 200, {
      session_id: sessionId,
      currency: body.currency,
      items: priced.map((item) => {
        const premium = (Math.round(Number(item.cost) * 8) / 100).toFixed(2);
        return { reference_id: item.reference_id, cart_item_id: crypto.randomUUID(), estimated_premium: premium, estimated_premium_literal: `$${premium}` };
      }),
    });
  }

  const submit = url.pathname.match(/^\/v1\/orders\/([^/]+)\/submit$/);
  if (req.method === 'POST' && submit) {
    if (!authorized) return send(res, 401, envelope(401, 'User session has expired or is invalid.Please try again.'));
    const sessionId = decodeURIComponent(submit[1]);
    const body = await readJson(req);
    if (!body?.reference_id || !body?.customer?.email || body?.payment?.type !== 'invoice') {
      return send(res, 422, { detail: [{ loc: ['body'], msg: 'Field required', type: 'missing' }] });
    }
    if (sessionId.startsWith('flaky-') && !flakyAttempts.has(sessionId)) {
      flakyAttempts.set(sessionId, 1);
      return send(res, 400, envelope(503, 'Temporarily unavailable.'));
    }
    if (sessionId.startsWith('dup-')) {
      // As if an earlier attempt went through but its response was lost.
      sessions.set(sessionId, { referenceId: body.reference_id, email: body.customer.email, submittedAt: Date.now() });
      return send(res, 409, { session_id: sessionId, status: 'already_submitted' });
    }
    if (sessions.has(sessionId)) return send(res, 409, { session_id: sessionId, status: 'already_submitted' });
    if (sessionId.startsWith('optout-')) return send(res, 204);

    sessions.set(sessionId, { referenceId: body.reference_id, email: body.customer.email, submittedAt: Date.now() });
    return send(res, 202, { session_id: sessionId, status: 'submitted' });
  }

  const details = url.pathname.match(/^\/v1\/orders\/([^/]+)\/details$/);
  if (req.method === 'GET' && details) {
    if (!authorized) return send(res, 401, envelope(401, 'User session has expired or is invalid.Please try again.'));
    const referenceId = decodeURIComponent(details[1]);
    const found = [...sessions.entries()].find(([, s]) => s.referenceId === referenceId);
    if (!found || Date.now() - found[1].submittedAt < 1000) return send(res, 404, { msg: 'Order not found', type: 'Not Found' });

    const [sessionId] = found;
    const base = `https://mock.helloteak.test/orders/${sessionId}`;
    return send(res, 200, {
      id: sessionId,
      reference_id: referenceId,
      created: new Date(found[1].submittedAt).toISOString(),
      items: [],
      primary_policies: [
        {
          primary_policy_id: '6b1f0f7e-2d7a-4c1e-9d55-0c6c8f1d2a11',
          product_slug: 'refund-protection',
          links: {
            certificate_url: `${base}/certificate`,
            policy_pdf: `${base}/terms.pdf`,
            refund_request_url: `${base}/refund`,
            cancellation_url: null,
            consumer_terms: null,
            faq_url: null,
            helpcenter_email: null,
            privacy_policy: null,
          },
        },
      ],
    });
  }

  send(res, 404, { msg: 'Not found', type: 'Not Found' });
});

const port = Number(process.env.PORT) || 4010;
server.listen(port, () => console.log(`Mock Teak API on http://localhost:${port}/v1`));
