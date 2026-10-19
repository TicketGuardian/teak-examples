// The Teak Partner API calls this example makes: an access token, Submit an order,
// and Retrieve order details. https://docs.helloteak.com/reference

const TEAK_API = process.env.TEAK_API_BASE || 'https://api.sandbox.helloteak.com/v1';

// Tokens expire after 5 minutes, so get a new one for each call rather than caching it.
async function getTeakToken() {
  const res = await fetch(`${TEAK_API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      public_key: process.env.TEAK_PUBLIC_KEY,
      secret_key: process.env.TEAK_SECRET_KEY,
    }),
  });
  if (!res.ok) throw new Error(`Teak auth failed: ${res.status}`);
  return (await res.json()).token;
}

// Submit the order, retrying where it's safe to. From the "Submit an order reliably" recipe.
// Returns 'submitted' or 'opted-out', or throws.
async function submitTeakOrder(sessionId, order) {
  const body = JSON.stringify({
    reference_id: order.number, // your order number, unique per order
    customer: order.customer, // { first_name, last_name, email }
    payment: { type: 'invoice' },
  });

  for (const delay of [0, 1000, 5000, 30000]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    let res;
    try {
      res = await fetch(`${TEAK_API}/orders/${encodeURIComponent(sessionId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getTeakToken()}` },
        body,
      });
    } catch (networkError) {
      continue;
    }

    if (res.status === 202) return 'submitted';
    if (res.status === 204) return 'opted-out';
    if (res.status === 401) continue;

    // Most errors are HTTP 400 with the real code in error.code.
    const error = (await res.json().catch(() => ({}))).error;
    if (error?.code === 409) return 'submitted'; // already submitted, e.g. by an earlier attempt
    if (error?.code === 503) continue;

    throw new Error(`Teak submit failed: ${res.status} ${JSON.stringify(error)}`);
  }
  throw new Error('Teak submit failed after retries');
}

// The customer's protection links, one entry per protection product on the order.
// Returns null while the order is still being created (404).
async function getProtectionLinks(orderNumber, email) {
  const url = `${TEAK_API}/orders/${encodeURIComponent(orderNumber)}/details?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getTeakToken()}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Teak order details failed: ${res.status}`);

  const details = await res.json();
  return details.primary_policies.map((product) => ({
    product: product.product_slug,
    certificate: product.links.certificate_url,
    terms: product.links.policy_pdf,
    refund: product.links.refund_request_url,
    cancel: product.links.cancellation_url,
  }));
}

module.exports = { submitTeakOrder, getProtectionLinks };
