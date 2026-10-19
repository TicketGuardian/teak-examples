# Checkout example

A ticket checkout with Teak refund protection: the [TeakOS Widget](https://docs.helloteak.com/docs/widget-installation) on the checkout page, and [Order Submit](https://docs.helloteak.com/docs/submit-the-order) from the server. It follows the [TeakOS integration guide](https://docs.helloteak.com/docs/teakos-integration-guide).

```
checkout/
  frontend/    the checkout and confirmation pages, shared by every backend
  node/        Node.js (Express) backend
  python/      Python (Flask) backend
```

## What happens

1. **The checkout page** ([`frontend/app.js`](frontend/app.js)) loads the widget and calls `configure` with one item per ticket. When the customer changes a quantity, it calls `configure` again with the whole cart. Opting in adds the protection price to the total, and opting out removes it.
2. **Placing the order** sends the cart, the customer, and the widget's session ID (`teak.get('token')`) to `POST /api/checkout`, then calls `teak('clearSession')`.
3. **The server** prices the cart from its own catalog, records the order, and responds straight away. It then [submits the order](https://docs.helloteak.com/reference/submit_partner_order) to Teak in the background, retrying where it's safe to, so a Teak problem never fails the customer's order.
4. **The confirmation page** polls `GET /api/orders/:number` until Teak has created the order, then shows the customer's protection links from [Retrieve order details](https://docs.helloteak.com/reference/get_partner_order_details).

If the widget can't load, checkout carries on without protection.

## Endpoints

Both backends serve the same endpoints:

| Endpoint | What it does |
|---|---|
| `GET /` | The checkout page |
| `GET /confirmation?order=` | The confirmation page |
| `GET /api/config` | The public key and the catalog, for the checkout page |
| `POST /api/checkout` | Places the order and submits it to Teak in the background |
| `GET /api/orders/:number` | The order's protection status and links |
| `GET /health` | Returns `ok` |

The Teak API calls are in [`node/teak.js`](node/teak.js) and [`python/teak.py`](python/teak.py).

## Run it

Set `TEAK_PUBLIC_KEY` and `TEAK_SECRET_KEY` in the root `.env`, then:

```bash
docker compose up checkout-node      # or checkout-python, on port 8081
```

Or without Docker, see the [root README](../README.md#without-docker). Open http://localhost:8080.

## Before production

- Store orders in your database instead of in memory.
- Submit from a job queue instead of in-process, so a restart doesn't lose a submit.
- Charge the order before you submit it to Teak.
- Remove `sandbox: true` from `configure`, and switch `TEAK_API_BASE` and your keys to production. See the [go-live checklist](https://docs.helloteak.com/docs/go-live-checklist).
