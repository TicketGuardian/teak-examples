# Webhooks example

A webhook endpoint for Teak events. It follows [Receiving webhooks](https://docs.helloteak.com/docs/receiving-webhooks) and the [Refund the customer when protection is voided](https://docs.helloteak.com/recipes/handle-contract-void) recipe.

```
webhooks/
  node/      Node.js (Express)
  python/    Python (Flask)
```

## What happens

For each `POST /webhooks/teak`:

1. **Verify the signature.** The `X-Protecht-Signature` header must be a valid HMAC-SHA256 of the raw body, keyed with your subscription's secret. Anything else gets `401`. See [Verifying webhook signatures](https://docs.helloteak.com/docs/verifying-webhook-signatures).
2. **Respond straight away** with `200`, then handle the event in the background.
3. **Ignore repeats.** Events have no ID, so the example identifies each one by `resource`, `action`, and `policy_number` (or `claim_number` for refund requests).
4. **Handle the event:**
   - [Contract events](https://docs.helloteak.com/docs/contract-events) (`resource: "Policy"`) record the contract and its status. **Contract Void** also refunds the protection price, `premium`, which you collected at checkout.
   - [Refund request events](https://docs.helloteak.com/docs/refund-request-events) (`resource: "Claim"`) are logged.

`GET /api/events` shows what the example has received, for trying it out. Don't expose it in production.

## Run it

Set `TEAK_WEBHOOK_SECRET` in the root `.env`, then:

```bash
docker compose up webhooks-node      # or webhooks-python, on port 8091
```

Send a signed test event:

```bash
node scripts/send-test-webhook.mjs contract-void http://localhost:8090/webhooks/teak
curl http://localhost:8090/api/events
```

To receive real sandbox webhooks, expose the endpoint over HTTPS, for example with a tunnel, and add its URL to a webhook subscription in the sandbox Teak Dashboard.

## Before production

- Put events on a job queue, and store contracts, refunds, and processed events in your database.
- Send refunds to your payment provider. `premium` is a decimal string, so pass it as a decimal, not a float.
- Serve the endpoint over HTTPS only.
