# Server-to-server example

A ticket store that offers Teak refund protection from its own server, with no Teak widget. It shows protection prices from [the Programs API](https://docs.helloteak.com/reference/create_partner_programs) on its search results and in checkout, and confirms the order with Teak when the purchase completes. It follows the [server-to-server guide](https://docs.helloteak.com/docs/server-to-server-guide).

```
server-to-server/
  frontend/    the search, checkout, and confirmation pages, shared by every backend
  node/        Node.js (Express) backend
  python/      Python (Flask) backend
```

> Server-to-server and AI integrations are for enterprise partners only. Teak Solutions team works with partners to determine the appropriate integration solution.

## What happens

1. **Offer.** The search page sends the customer's location to `POST /api/search`. The server prices every result in one call to [the Programs API](https://docs.helloteak.com/docs/server-offer), which starts the purchase's Teak session, and the page shows each price next to its result. If the call fails or times out, the results show without protection.
2. **Checkout.** `POST /api/cart` prices the cart again on the same session, with one Teak item per ticket. The checkout page shows the offer itself: optional protection is added to the total only when the customer accepts it, and embedded protection is shown as included.
3. **Confirm the order.** `POST /api/checkout` records the order and responds straight away. The server then [confirms the order](https://docs.helloteak.com/docs/server-confirm-the-order) with Teak in the background, with the customer's choices and details, so a Teak problem never fails the customer's order. The cart and its session are then dropped, and the next purchase starts a new one.
4. **The confirmation page** polls `GET /api/orders/:number` until the order's protection status settles.

The server also keeps track of the [session's lifetime](https://docs.helloteak.com/docs/sessions#how-long-a-session-lasts): 2 hours after the last call to the Programs API, and 24 hours at most. When a session expires, it starts a new one.

## Set up Confirm the order

Your Teak integration contact gives you the calls for the Confirm the order step during onboarding. Add them to one function: `confirmTeakOrder()` in [`node/teak.js`](node/teak.js), or `confirm_teak_order()` in [`python/teak.py`](python/teak.py). Its comments describe what it receives and what it returns. Nothing else in the example needs to change.

Until then, orders complete as normal, and their protection status is `not-set-up`.

## Endpoints

Both backends serve the same endpoints:

| Endpoint | What it does |
|---|---|
| `GET /` | The search page |
| `GET /checkout` | The checkout page |
| `GET /confirmation?order=` | The confirmation page |
| `POST /api/search` | Prices every result with the Programs API, and returns the cart ID |
| `POST /api/cart` | Prices the cart on the same session |
| `POST /api/checkout` | Places the order and confirms it with Teak in the background |
| `GET /api/orders/:number` | The order's protection status |
| `GET /health` | Returns `ok` |

The Teak API calls are in [`node/teak.js`](node/teak.js) and [`python/teak.py`](python/teak.py).

## Run it

Set `TEAK_PUBLIC_KEY` and `TEAK_SECRET_KEY` in the root `.env`, and `TEAK_COVERAGE` to `optional` or `embedded` to match your account. Then:

```bash
docker compose up server-to-server-node      # or server-to-server-python, on port 8101
```

Or without Docker, see the [root README](../README.md#without-docker). Open http://localhost:8100.

For Teak's webhooks, the Notify step, see the [webhooks example](../webhooks).

## Before production

- Store carts and orders in your database instead of in memory.
- Confirm orders from a job queue instead of in-process, so a restart doesn't lose one.
- Charge the order before you confirm it with Teak.
- Take the customer's location from their billing address, or the country and region you already know, instead of asking.
- Switch `TEAK_API_BASE` and your keys to production. See the [server-to-server go-live checklist](https://docs.helloteak.com/docs/server-go-live).
