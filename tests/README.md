# Tests

One set of end-to-end tests per example, run against every backend with [Playwright](https://playwright.dev). They check that each backend behaves the same way.

| File | What it covers |
|---|---|
| [`specs/checkout.spec.js`](specs/checkout.spec.js) | The checkout API, and the checkout and confirmation pages in a browser |
| [`specs/webhooks.spec.js`](specs/webhooks.spec.js) | Signature checks, contract and refund request events, and repeat deliveries |
| [`mock-teak/`](mock-teak) | A mock of the Teak API calls the examples make, so the tests need no keys |
| [`fixtures/fake-teak.js`](fixtures/fake-teak.js) | A stand-in for the widget, used by the browser tests |
| [`fixtures/events/`](fixtures/events) | Webhook payloads, from the Teak API reference |

## Run them

Start an example against the mock API, then point the tests at it:

```bash
# from the repo root
docker compose -f docker-compose.yml -f docker-compose.test.yml up --build --wait checkout-python

cd tests
npm install
npx playwright install chromium
BASE_URL=http://localhost:8081 npx playwright test --project=checkout
```

| Example | Port | Project |
|---|---|---|
| `checkout-node` | 8080 | `checkout` |
| `checkout-python` | 8081 | `checkout` |
| `webhooks-node` | 8090 | `webhooks` |
| `webhooks-python` | 8091 | `webhooks` |

## Adding a backend

A new language needs the same endpoints as the others. Add its Dockerfile and a service to both compose files, add it to the matrix in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), and the existing tests run against it.
