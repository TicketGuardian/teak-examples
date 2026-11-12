// The shopper's cart ID, location, and quantities, kept in the browser between pages.
// The server keeps the cart itself, including its Teak session.
const store = {
  read() {
    try {
      return JSON.parse(sessionStorage.getItem('cart')) || {};
    } catch {
      return {};
    }
  },
  write(value) {
    try {
      sessionStorage.setItem('cart', JSON.stringify(value));
    } catch {
      // Private browsing can block storage. The page still works for this visit.
    }
  },
  clear() {
    try {
      sessionStorage.removeItem('cart');
    } catch {}
  },
};

const money = (amount) => `$${Number(amount).toFixed(2)}`;
const $ = (id) => document.getElementById(id);

// "US-TX" -> { country: "US", region: "TX" }
function toLocation(value) {
  const [country, region] = value.split('-');
  return { country, region };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
