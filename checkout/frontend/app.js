// Checkout page: shows the cart, keeps the Teak widget in step with it, and places the order.
// The same file is served by every backend in this example.

const state = {
  config: null,
  quantities: { ga: 2, vip: 0 },
  protectionPrice: null, // the protection price as a string, e.g. "6.50", or null when not protected
};

const money = (amount) => `$${Number(amount).toFixed(2)}`;
const $ = (id) => document.getElementById(id);

function cartLines() {
  return state.config.catalog
    .map((product) => ({ ...product, quantity: state.quantities[product.id] || 0 }))
    .filter((line) => line.quantity > 0);
}

// One Teak item per ticket: two tickets are two items, each with its own referenceNumber, and
// its product type as your inventory labels it. https://docs.helloteak.com/docs/widget-configuration#items
function teakItems() {
  return cartLines().flatMap((line) =>
    Array.from({ length: line.quantity }, (_, i) => ({
      name: line.name,
      referenceNumber: `${line.id}-${i + 1}`,
      productTypes: [line.productType],
      cost: line.price,
      event: line.event,
    }))
  );
}

// Call configure with the whole cart every time it changes. The widget re-prices and keeps
// the customer's choice. https://docs.helloteak.com/docs/handle-the-customers-choice
function configureTeak() {
  const items = teakItems();
  document.querySelector('teak-widget').hidden = items.length === 0;
  if (!state.config.publicKey || items.length === 0) return;

  teak('configure', {
    apiKey: state.config.publicKey,
    sandbox: true,
    currency: 'USD',
    locale: 'en_US',
    items,
    optInCb: () => setProtection(teak.get('quote')),
    optOutCb: () => setProtection(null), // also called when the widget fails, with no context
    updatedCb: () => {
      if (teak.isProtected()) setProtection(teak.get('quote'));
    },
    onErrorCb: () => setProtection(null),
  });
}

function setProtection(price) {
  state.protectionPrice = price;
  renderTotals();
}

function renderCart() {
  $('cart').innerHTML = '';
  for (const product of state.config.catalog) {
    const quantity = state.quantities[product.id] || 0;
    const li = document.createElement('li');
    li.className = 'cart-line';
    li.innerHTML = `
      <div>
        <div class="cart-name"></div>
        <div class="cart-meta"></div>
      </div>
      <div class="stepper">
        <button type="button" data-step="-1" aria-label="Remove one">−</button>
        <output aria-live="polite">${quantity}</output>
        <button type="button" data-step="1" aria-label="Add one">+</button>
      </div>
      <div class="cart-price">${money(product.price * quantity)}</div>`;
    li.querySelector('.cart-name').textContent = product.name;
    li.querySelector('.cart-meta').textContent = `${money(product.price)} each · ${product.event.location}`;
    li.querySelectorAll('[data-step]').forEach((button) =>
      button.addEventListener('click', () => changeQuantity(product.id, Number(button.dataset.step)))
    );
    $('cart').append(li);
  }
  renderTotals();
}

function renderTotals() {
  const subtotal = cartLines().reduce((sum, line) => sum + line.price * line.quantity, 0);
  const protection = state.protectionPrice ? Number(state.protectionPrice) : 0;
  $('subtotal').textContent = money(subtotal);
  $('protection-row').hidden = !state.protectionPrice;
  $('protection').textContent = money(protection);
  $('total').textContent = money(subtotal + protection);
  $('place-order').disabled = subtotal === 0;
}

function changeQuantity(productId, step) {
  const next = Math.min(10, Math.max(0, (state.quantities[productId] || 0) + step));
  if (next === state.quantities[productId]) return;
  state.quantities[productId] = next;
  renderCart();
  configureTeak();
}

async function placeOrder(event) {
  event.preventDefault();
  $('checkout-error').hidden = true;
  $('place-order').disabled = true;

  // The session ID holds the quote and the customer's choice. Send it even if the customer
  // opted out. It's missing only if the widget never loaded.
  const teakSessionId = typeof teak.get === 'function' ? teak.get('token') : null;
  const customer = Object.fromEntries(new FormData($('checkout-form')));

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cart: cartLines().map(({ id, quantity }) => ({ id, quantity })),
        customer,
        teakSessionId,
        protectionPrice: state.protectionPrice,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Checkout failed (${res.status})`);
    const { orderNumber } = await res.json();

    // The session is closed once the order is placed. Clear it so the next purchase starts fresh.
    teak('clearSession');
    window.location.href = `/confirmation?order=${encodeURIComponent(orderNumber)}`;
  } catch (err) {
    $('checkout-error').textContent = err.message;
    $('checkout-error').hidden = false;
    $('place-order').disabled = false;
  }
}

async function start() {
  state.config = await (await fetch('/api/config')).json();
  $('config-warning').hidden = Boolean(state.config.publicKey);
  $('checkout-form').addEventListener('submit', placeOrder);
  renderCart();
  configureTeak();
}

start();
