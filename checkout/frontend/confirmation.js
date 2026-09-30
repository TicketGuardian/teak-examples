// Confirmation page: shows whether protection was issued and the customer's protection links.
// Teak creates the order a few seconds after Submit returns 202, so the page polls the server.

const orderNumber = new URLSearchParams(window.location.search).get('order');
const status = document.getElementById('protection-status');
const links = document.getElementById('protection-links');

const MESSAGES = {
  pending: 'Checking your protection…',
  submitted: 'Your protection is being issued. Your links will appear here in a moment.',
  issued: 'Your tickets are protected. Teak has emailed you the details.',
  'opted-out': 'You chose not to add refund protection.',
  'not-offered': "Refund protection wasn't available for this order.",
  failed: "We couldn't confirm your protection. Our team has been alerted.",
};

const LINK_LABELS = {
  certificate: 'View your certificate',
  terms: 'Read the terms',
  refund: 'Request a refund',
  cancel: 'Cancel your protection',
};

function show(order) {
  const state = order.links ? 'issued' : order.protection;
  status.dataset.status = state;
  status.textContent = MESSAGES[state] || MESSAGES.pending;

  if (!order.links) return;
  links.innerHTML = '';
  for (const product of order.links) {
    for (const [key, label] of Object.entries(LINK_LABELS)) {
      if (!product[key]) continue; // a link is null when it doesn't apply to the product
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = product[key];
      a.textContent = label;
      a.target = '_blank';
      a.rel = 'noopener';
      li.append(a);
      links.append(li);
    }
  }
  links.hidden = false;
}

async function poll(attempt = 0) {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`);
  if (!res.ok) {
    status.textContent = "We couldn't find this order.";
    return;
  }
  const order = await res.json();
  show(order);

  const done = order.links || ['opted-out', 'not-offered', 'failed'].includes(order.protection);
  if (!done && attempt < 30) setTimeout(() => poll(attempt + 1), 2000);
}

document.getElementById('order-number').textContent = orderNumber;
poll();
