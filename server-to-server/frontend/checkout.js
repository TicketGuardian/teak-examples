// Checkout page: prices the cart on the same Teak session, shows the protection offer, and places
// the order. The server confirms the order with Teak in the background.

const state = { quantities: {}, ...store.read(), cart: null };

function renderCart() {
  const { lines, subtotal, protectionTotal, coverage } = state.cart;
  $('cart').innerHTML = '';
  for (const line of lines) {
    const li = document.createElement('li');
    li.className = 'cart-line cart-line-static';
    li.innerHTML = '<div><div class="cart-name"></div><div class="cart-meta"></div></div><div class="cart-price"></div>';
    li.querySelector('.cart-name').textContent = line.name;
    li.querySelector('.cart-meta').textContent = `${line.quantity} × ${money(line.price)}`;
    li.querySelector('.cart-price').textContent = money(Number(line.price) * line.quantity);
    $('cart').append(li);
  }

  // No price from Teak means no offer: the customer checks out without protection.
  $('offer').hidden = !protectionTotal;
  $('offer-optional').hidden = !protectionTotal || coverage !== 'optional';
  $('offer-embedded').hidden = !protectionTotal || coverage !== 'embedded';
  $('offer-price').textContent = protectionTotal ? money(protectionTotal) : '';

  // Optional protection is added to the total only when the customer accepts it. Embedded
  // protection is already part of the ticket price.
  const accepted = coverage === 'optional' && $('accept-protection').checked && protectionTotal;
  $('subtotal').textContent = money(subtotal);
  $('protection-row').hidden = !accepted;
  $('protection').textContent = money(accepted ? protectionTotal : 0);
  $('total').textContent = money(Number(subtotal) + (accepted ? Number(protectionTotal) : 0));
  $('place-order').disabled = false;
}

async function priceCart() {
  try {
    state.cart = await postJson('/api/cart', {
      cartId: state.cartId,
      location: toLocation(state.location || 'US-TX'),
      quantities: state.quantities,
    });
    renderCart();
  } catch (err) {
    $('checkout-error').textContent = err.message;
    $('checkout-error').hidden = false;
  }
}

async function placeOrder(event) {
  event.preventDefault();
  $('checkout-error').hidden = true;
  $('place-order').disabled = true;
  try {
    const { orderNumber } = await postJson('/api/checkout', {
      cartId: state.cartId,
      accepted: $('accept-protection').checked,
      customer: Object.fromEntries(new FormData($('checkout-form'))),
    });
    // The Teak session is closed once the order is placed. The next purchase starts fresh.
    store.clear();
    window.location.href = `/confirmation?order=${encodeURIComponent(orderNumber)}`;
  } catch (err) {
    $('checkout-error').textContent = err.message;
    $('checkout-error').hidden = false;
    $('place-order').disabled = false;
  }
}

$('accept-protection').addEventListener('change', renderCart);
$('checkout-form').addEventListener('submit', placeOrder);
priceCart();
