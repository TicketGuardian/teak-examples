"""Checkout example, Python backend. Serves the shared frontend and submits orders to Teak."""
import logging
import os
import secrets
import threading
import time
from pathlib import Path

from dotenv import load_dotenv

# The repo-root .env, when running from a clone. In Docker, variables come from the environment.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from flask import Flask, jsonify, request, send_from_directory  # noqa: E402

from teak import get_protection_links, submit_teak_order  # noqa: E402

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("checkout")

# What the store sells. Prices are set here on the server, never taken from the browser.
EVENT = {
    "name": "Summer Fest",
    "location": "Austin, TX",
    "startDatetime": "2026-07-18T18:00:00-05:00",
    "endDatetime": "2026-07-18T23:00:00-05:00",
}
CATALOG = [
    {"id": "ga", "name": "Summer Fest - General Admission", "price": 120, "event": EVENT},
    {"id": "vip", "name": "Summer Fest - VIP", "price": 280, "event": EVENT},
]

# Orders are kept in memory. Use your database.
orders = {}

app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")


@app.get("/")
def checkout_page():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/confirmation")
def confirmation_page():
    return send_from_directory(FRONTEND, "confirmation.html")


@app.get("/health")
def health():
    return "ok"


@app.get("/api/config")
def config():
    return jsonify(publicKey=os.environ.get("TEAK_PUBLIC_KEY") or None, catalog=CATALOG)


def price_cart(cart):
    lines = []
    for line in cart if isinstance(cart, list) else []:
        product = next((p for p in CATALOG if p["id"] == line.get("id")), None)
        quantity = line.get("quantity")
        if product and type(quantity) is int and 0 < quantity <= 10:
            lines.append({"id": product["id"], "name": product["name"], "price": product["price"], "quantity": quantity})
    return lines


@app.post("/api/checkout")
def checkout():
    body = request.get_json(silent=True) or {}
    lines = price_cart(body.get("cart"))
    customer = body.get("customer") or {}
    if not lines or not all(customer.get(k) for k in ("first_name", "last_name", "email")):
        return jsonify(error="Add a ticket and fill in your details."), 400

    # Create and charge the order in your system first. This example only records it.
    session_id = body.get("teakSessionId")
    order = {
        "number": f"ORD-{int(time.time() * 1000)}-{secrets.randbelow(9000) + 1000}",
        "lines": lines,
        "customer": {k: customer[k] for k in ("first_name", "last_name", "email")},
        "protection_price": body.get("protectionPrice"),
        "protection": "pending" if session_id else "not-offered",
        "links": None,
    }
    orders[order["number"]] = order

    # The customer's order is complete. Submit it to Teak in the background, so retries never
    # hold up checkout, and a Teak failure never fails the order. In production, use a task queue.
    if session_id:
        threading.Thread(target=submit_in_background, args=(session_id, order), daemon=True).start()
    return jsonify(orderNumber=order["number"])


def submit_in_background(session_id, order):
    try:
        order["protection"] = submit_teak_order(session_id, order)
    except Exception:
        order["protection"] = "failed"
        logger.exception("Order %s: Teak submit failed", order["number"])  # alert your team


@app.get("/api/orders/<number>")
def get_order(number):
    order = orders.get(number)
    if not order:
        return "", 404

    # Links are available once Teak has created the order, a few seconds after Submit.
    if order["protection"] == "submitted" and not order["links"]:
        try:
            order["links"] = get_protection_links(order["number"], order["customer"]["email"])
        except Exception:
            logger.exception("Order %s: Teak order details failed", order["number"])
    return jsonify(orderNumber=order["number"], protection=order["protection"], links=order["links"])


if __name__ == "__main__":
    if not os.environ.get("TEAK_PUBLIC_KEY") or not os.environ.get("TEAK_SECRET_KEY"):
        logger.warning("Set TEAK_PUBLIC_KEY and TEAK_SECRET_KEY in .env. See .env.example.")
    app.run(port=int(os.environ.get("PORT", 8080)), debug=True)
