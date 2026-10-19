// A stand-in for the Teak Partner API, so the examples can be tested without sandbox keys.
// It covers only the calls the examples make, with the same shapes as the real API.
// Special session IDs trigger other outcomes:
//   optout-...   Submit returns 204, as when the customer didn't opt in
//   flaky-...    Submit fails once with error.code 503, then succeeds
// Submitting a session twice returns error.code 409, as the real API does.
// Order details return 404 for 1 second after Submit, while the order is "being created".
const http = require('http');

const TOKEN = 'mock-access-token';
const sessions = new Map(); // session ID -> { referenceId, email, submittedAt }
const flakyAttempts = new Map();

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
    if (sessions.has(sessionId)) return send(res, 400, envelope(409, `Order for session ${sessionId} already exists`));
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
