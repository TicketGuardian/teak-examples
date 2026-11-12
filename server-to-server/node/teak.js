// The Teak Partner API calls this example makes: an access token, Get programs, and the
// Confirm the order step. https://docs.helloteak.com/docs/server-to-server-guide

const TEAK_API = process.env.TEAK_API_BASE || 'https://api.sandbox.helloteak.com/v1';

// This server calls Teak on every search, so it reuses one access token until it's close to
// expiring. Tokens last 5 minutes. https://docs.helloteak.com/docs/environments-and-keys#reuse-the-token
let cached = { token: null, expiresAt: 0 };

async function getTeakToken() {
  // Renew a minute early, so a token never expires mid-request.
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch(`${TEAK_API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      public_key: process.env.TEAK_PUBLIC_KEY,
      secret_key: process.env.TEAK_SECRET_KEY,
    }),
  });
  if (!res.ok) throw new Error(`Teak auth failed: ${res.status}`);
  cached = { token: (await res.json()).token, expiresAt: Date.now() + 5 * 60_000 };
  return cached.token;
}

// Get programs: a protection price for each item, on the purchase's session.
// Leave sessionId out on the first call, and Teak starts a session.
// https://docs.helloteak.com/docs/server-offer
async function getPrograms({ sessionId, location, items }) {
  const body = JSON.stringify({
    ...(sessionId ? { session_id: sessionId } : {}),
    currency: 'USD',
    locale: 'en_US',
    location, // { country: 'US', region: 'TX' }: strongly preferred over ip_address or phone_number
    items,
  });
  const send = async () =>
    fetch(`${TEAK_API}/programs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getTeakToken()}` },
      body,
      signal: AbortSignal.timeout(2000), // a protection price must never hold up the page
    });

  let res = await send();
  if (res.status === 401) {
    cached.token = null; // rejected token: get a new one and retry once
    res = await send();
  }
  // One bad item fails the whole call, and the error names it.
  if (!res.ok) throw new Error(`Teak Get programs failed: ${res.status} ${await res.text()}`);
  return res.json();
}

class ConfirmNotSetUpError extends Error {}

// Confirm the order: record the customer's choices and place the order with Teak.
//
// Your Teak integration contact gives you the calls for this step during onboarding. Put them
// here. Everything else in this example stays the same.
// https://docs.helloteak.com/docs/server-confirm-the-order
//
//   sessionId  the session from Get programs
//   choices    [{ referenceId, accepted }], one per optional item. Embedded protection is added by Teak.
//   order      { number, customer: { first_name, last_name, email } }: the person booking
//
// Return 'placed' when Teak accepts the order (202) or says it was already placed, and
// 'declined' when nothing is protected (204). Retry 401 with a new token, and 503 with backoff,
// on the same session. Throw on anything else.
async function confirmTeakOrder({ sessionId, choices, order }) {
  throw new ConfirmNotSetUpError(
    'Confirm the order isn\'t set up yet: add the calls from your Teak integration contact to confirmTeakOrder() in teak.js.'
  );
}

module.exports = { getPrograms, confirmTeakOrder, ConfirmNotSetUpError };
