# Teak examples

Complete, runnable examples of a [Teak](https://docs.helloteak.com) integration, in Node.js and Python. Each example goes with a page in the [Teak developer docs](https://docs.helloteak.com), and every backend in an example does the same thing, so you can pick your language and follow along.

| Example | What it shows | Node.js | Python | Docs |
|---|---|---|---|---|
| [Checkout](checkout) | The TeakOS Widget on a checkout page, Order Submit from your server, and the customer's protection links | [`checkout/node`](checkout/node) | [`checkout/python`](checkout/python) | [Integration guide](https://docs.helloteak.com/docs/widget-and-order-submit), [Quickstart](https://docs.helloteak.com/recipes/quickstart) |
| [Webhooks](webhooks) | Verifying webhook signatures, recording issued contracts, and refunding voided ones | [`webhooks/node`](webhooks/node) | [`webhooks/python`](webhooks/python) | [Receiving webhooks](https://docs.helloteak.com/docs/receiving-webhooks) |

## Set up

You need sandbox keys from your Teak integration contact. See [Environments and keys](https://docs.helloteak.com/docs/environments-and-keys).

```bash
git clone https://github.com/TicketGuardian/teak-examples.git
cd teak-examples
cp .env.example .env
```

Fill in `.env`. Every example reads it:

| Variable | Used by | What it is |
|---|---|---|
| `TEAK_PUBLIC_KEY` | Checkout | Your public key (`pk_...`). The widget uses it in the browser. |
| `TEAK_SECRET_KEY` | Checkout | Your secret key (`sk_...`). Only your server uses it, to get access tokens. |
| `TEAK_WEBHOOK_SECRET` | Webhooks | Your webhook subscription's secret, from the Teak Dashboard. |
| `TEAK_API_BASE` | Both | The Teak Partner API. Defaults to sandbox. |

Never commit `.env`. It's in `.gitignore`.

## Run an example

### With Docker

```bash
docker compose up checkout-node      # http://localhost:8080
docker compose up checkout-python    # http://localhost:8081
docker compose up webhooks-node      # http://localhost:8090/webhooks/teak
docker compose up webhooks-python    # http://localhost:8091/webhooks/teak
```

### Without Docker

Each example runs on port 8080 by default. Set `PORT` to change it.

**Node.js** (20 or later):

```bash
cd checkout/node
npm install
npm start
```

**Python** (3.10 or later):

```bash
cd checkout/python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Use the same commands in `webhooks/node` and `webhooks/python`.

## Test

The [`tests`](tests) folder has one set of end-to-end tests for each example, and they run against every backend. They use a mock of the Teak API, so they don't need keys:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up --build --wait checkout-node

cd tests
npm install
npx playwright install chromium
BASE_URL=http://localhost:8080 npx playwright test --project=checkout
```

For the webhooks tests, start `webhooks-node` or `webhooks-python` and run `--project=webhooks` against its port. CI runs every example this way on each pull request.

To send a signed test webhook to a running webhooks example:

```bash
node scripts/send-test-webhook.mjs contract-void http://localhost:8090/webhooks/teak
```

## Using this code

These examples show how an integration fits together. They keep orders and events in memory and do their background work in-process, so replace those with your database and a job queue before you use the code in production. Each place is marked in the code.

## Get help

- [Teak developer docs](https://docs.helloteak.com)
- [Troubleshooting](https://docs.helloteak.com/docs/troubleshooting)
- Your Teak integration contact

## License

[MIT](LICENSE)
