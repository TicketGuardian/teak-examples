"""Webhooks example, Python. Verifies each webhook's signature, responds straight away,
then handles the event: records issued contracts and refunds voided ones.
https://docs.helloteak.com/docs/receiving-webhooks"""
import base64
import hashlib
import hmac
import json
import logging
import os
import queue
import threading
from pathlib import Path

from dotenv import load_dotenv

# The repo-root .env, when running from a clone. In Docker, variables come from the environment.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from flask import Flask, abort, jsonify, request  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("webhooks")

# Kept in memory. Use your database.
contracts = {}  # policy_number -> contract
refunds = []  # refunds you'd send to your payment provider
log = []  # every delivery and what happened to it, newest first
processed = set()  # event identities already handled


def verify_teak_signature(raw_body: bytes, header: str, secret: str) -> bool:
    """From the "Verify a webhook signature" recipe.
    https://docs.helloteak.com/docs/verifying-webhook-signatures"""
    if not secret or not header or not header.startswith("sha256:"):
        return False
    received = header.split(":", 1)[1].strip()
    expected = base64.b64encode(
        hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    ).decode("utf-8")
    return hmac.compare_digest(received, expected)


def event_key(event):
    """Events have no ID, and Teak can deliver one more than once. These fields identify an event."""
    data = event.get("data") or {}
    event_id = data.get("claim_number") if event.get("resource") == "Claim" else data.get("policy_number")
    return f'{event.get("resource")}:{event.get("action")}:{event_id}'


def handle_teak_event(event):
    key = event_key(event)
    if key in processed:
        log.insert(0, {"key": key, "outcome": "duplicate, ignored"})
        return

    data = event.get("data") or {}
    outcome = "ignored"
    if event.get("resource") == "Policy":
        # A contract event: one per protected item. https://docs.helloteak.com/docs/contract-events
        contracts[data["policy_number"]] = {
            "policyNumber": data["policy_number"],
            "orderNumber": data["order_number"],  # the reference_id you submitted
            "referenceNumber": data["reference_number"],  # the item's referenceNumber from the widget
            "status": data["status"],
        }
        outcome = f'contract {data["status"]}'

        if event.get("action") == "Voided":
            # You collected the protection price at checkout, so refund it. premium is a decimal
            # string: pass it to your payment provider as a Decimal, not a float.
            refunds.append({
                "orderNumber": data["order_number"],
                "referenceNumber": data["reference_number"],
                "amount": data["premium"],
                "currency": data["currency"],
            })
            outcome = f'contract voided, refunded {data["premium"]} {data["currency"]}'
    elif event.get("resource") == "Claim":
        # A refund request event. https://docs.helloteak.com/docs/refund-request-events
        outcome = f'refund request {data["claim_number"]} {data["status"]}'

    processed.add(key)
    log.insert(0, {"key": key, "outcome": outcome})
    logger.info("%s: %s", key, outcome)


# Respond first, then do the work on a background thread. In production, use a task queue.
events = queue.Queue()


def worker():
    while True:
        event = events.get()
        try:
            handle_teak_event(event)
        except Exception:
            logger.exception("Couldn't handle event")


threading.Thread(target=worker, daemon=True).start()

app = Flask(__name__)


@app.get("/health")
def health():
    return "ok"


@app.post("/webhooks/teak")
def teak_webhook():
    # Check the signature against the raw body, exactly as it was sent.
    raw_body = request.get_data()
    if not verify_teak_signature(raw_body, request.headers.get("X-Protecht-Signature"), os.environ.get("TEAK_WEBHOOK_SECRET")):
        abort(401)
    try:
        event = json.loads(raw_body)
    except ValueError:
        abort(400)
    if not isinstance(event, dict):
        abort(400)

    # Respond within 10 seconds, then do the work.
    events.put(event)
    return "", 200


@app.get("/api/events")
def list_events():
    """What the example has received, for trying it out. Don't expose this in production."""
    return jsonify(log=log, contracts=list(contracts.values()), refunds=refunds)


if __name__ == "__main__":
    if not os.environ.get("TEAK_WEBHOOK_SECRET"):
        logger.warning("Set TEAK_WEBHOOK_SECRET in .env. Until you do, every webhook is rejected with 401.")
    app.run(port=int(os.environ.get("PORT", 8080)), debug=True, use_reloader=False)
