// Search page: one Get programs call prices every result, and starts the purchase's Teak session.
// A result without a price is shown without protection: a failed or slow call never blocks the page.

const state = { ...{ quantities: {}, location: 'US-TX' }, ...store.read() };

// The event's local date and time, as in its ISO 8601 string, which keeps the event's UTC offset.
function eventTime(iso) {
  const [date, time] = iso.split('T');
  const local = new Date(`${date}T${time.slice(0, 5)}:00`);
  return local.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderResults(results, coverage) {
  $('results').innerHTML = '';
  for (const result of results) {
    const quantity = state.quantities[result.id] || 0;
    const li = document.createElement('li');
    li.className = 'result';
    li.dataset.testid = 'result';
    li.innerHTML = `
      <div>
        <div class="cart-name"></div>
        <div class="cart-meta"></div>
        <div class="protection-price" data-testid="protection-price"></div>
      </div>
      <div class="result-price"></div>
      <div class="stepper">
        <button type="button" data-step="-1" aria-label="Remove one">−</button>
        <output aria-live="polite">${quantity}</output>
        <button type="button" data-step="1" aria-label="Add one">+</button>
      </div>`;
    li.querySelector('.cart-name').textContent = result.name;
    li.querySelector('.cart-meta').textContent = `${result.venue} · ${eventTime(result.startsAt)}`;
    li.querySelector('.result-price').textContent = money(result.price);
    // Show Teak's price exactly as returned. Never calculate one yourself.
    const protection = li.querySelector('.protection-price');
    protection.hidden = !result.protectionPrice;
    protection.textContent = coverage === 'embedded'
      ? 'Refund protection included'
      : `Refund protection available: ${money(result.protectionPrice)}`;
    li.querySelectorAll('[data-step]').forEach((button) =>
      button.addEventListener('click', () => {
        const next = Math.min(10, Math.max(0, (state.quantities[result.id] || 0) + Number(button.dataset.step)));
        state.quantities[result.id] = next;
        li.querySelector('output').textContent = next;
        save();
      })
    );
    $('results').append(li);
  }
  $('results').setAttribute('aria-busy', 'false');
}

function save() {
  store.write(state);
  $('go-to-checkout').disabled = !Object.values(state.quantities).some((quantity) => quantity > 0);
}

async function search() {
  $('results').setAttribute('aria-busy', 'true');
  const { cartId, coverage, results } = await postJson('/api/search', {
    cartId: state.cartId,
    location: toLocation(state.location),
  });
  state.cartId = cartId; // the server keeps the Teak session with this cart
  save();
  renderResults(results, coverage);
}

$('location').value = state.location;
$('location').addEventListener('change', () => {
  state.location = $('location').value;
  // Location is fixed for a session, so a new location starts a new cart and session.
  delete state.cartId;
  search();
});
$('go-to-checkout').addEventListener('click', () => (window.location.href = '/checkout'));
save();
search();
