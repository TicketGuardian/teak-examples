// Confirmation page: polls the order until the server has confirmed it with Teak.
const MESSAGES = {
  'pending': 'Checking your protection…',
  'placed': 'Your tickets are protected. Look out for your protection details.',
  'declined': 'You chose not to add refund protection.',
  'not-offered': 'Refund protection wasn\'t available for this order.',
  'not-set-up': 'This example doesn\'t confirm orders with Teak yet. See the README to set it up.',
  'failed': 'We couldn\'t confirm your protection. Our team has been told, and your order is unaffected.',
};

const orderNumber = new URLSearchParams(window.location.search).get('order');
document.getElementById('order-number').textContent = orderNumber;

async function poll() {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`);
  const order = res.ok ? await res.json() : { protection: 'failed' };
  const status = document.getElementById('protection-status');
  status.dataset.status = order.protection;
  status.textContent = MESSAGES[order.protection] || MESSAGES.failed;
  if (order.protection === 'pending') setTimeout(poll, 1000);
}

poll();
