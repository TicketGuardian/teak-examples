"""Server-to-server example, Python backend. Prices protection with the Programs API, shows it in
the store's own pages, and confirms the order with Teak. There's no Teak widget.
https://docs.helloteak.com/docs/server-to-server-guide"""
import logging
import os
import re
import secrets
import threading
import time
import uuid
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

# The repo-root .env, when running from a clone. In Docker, variables come from the environment.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from flask import Flask, jsonify, request, send_from_directory  # noqa: E402

from teak import ConfirmNotSetUpError, confirm_teak_order, get_programs  # noqa: E402

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server-to-server")

# Whether the account's protection is optional (the customer accepts or declines it) or
# embedded (included in the ticket price). Your Teak integration contact tells you which.
COVERAGE = "embedded" if os.environ.get("TEAK_COVERAGE") == "embedded" else "optional"

# What the store sells. Prices are set here on the server, never taken from the browser.
# Event times carry the event's own UTC offset. https://docs.helloteak.com/docs/server-offer#event-times
EVENTS = [
    {"id": "summer-fest", "name": "Summer Fest - General Admission", "eventName": "Summer Fest", "venue": "Austin, TX", "productType": "general-admission", "price": "57.50", "startsAt": "2026-07-18T19:00:00-05:00", "endsAt": "2026-07-18T23:00:00-05:00"},
    {"id": "summer-fest-vip", "name": "Summer Fest - VIP", "eventName": "Summer Fest", "venue": "Austin, TX", "productType": "general-admission", "price": "149.00", "startsAt": "2026-07-18T19:00:00-05:00", "endsAt": "2026-07-18T23:00:00-05:00"},
    {"id": "jazz-night", "name": "Jazz Night - Balcony", "eventName": "Jazz Night", "venue": "New York, NY", "productType": "general-admission", "price": "85.00", "startsAt": "2026-08-07T20:00:00-04:00", "endsAt": "2026-08-07T23:00:00-04:00"},
]

# A session lasts 2 hours after the last call to the Programs API, and 24 hours at most.
# An expired session can't be revived. https://docs.helloteak.com/docs/sessions
SESSION_IDLE_SECONDS = 2 * 60 * 60
SESSION_MAX_SECONDS = 24 * 60 * 60

# Carts and orders are kept in memory. Use your database.
carts = {}  # cart ID -> {session, location, lines, teak_items, protection_total}
orders = {}

app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")


def money(amount):
    return f"{Decimal(amount):.2f}"


def get_cart(cart_id):
    if cart_id and cart_id in carts:
        return carts[cart_id]
    cart = {"id": str(uuid.uuid4()), "session": None}
    carts[cart["id"]] = cart
    return cart


def live_session_id(cart):
    """The cart's Teak session, or None if there's none or it has expired."""
    session = cart.get("session")
    if not session:
        return None
    now = time.time()
    if now - session["last_call_at"] > SESSION_IDLE_SECONDS or now - session["started_at"] > SESSION_MAX_SECONDS:
        cart["session"] = None  # start a new one, and show the new prices
        return None
    return session["id"]


def remember_session(cart, session_id):
    now = time.time()
    if cart.get("session") and cart["session"]["id"] == session_id:
        cart["session"]["last_call_at"] = now
    else:
        cart["session"] = {"id": session_id, "started_at": now, "last_call_at": now}


def read_location(location):
    """Where the customer is, as ISO country and region codes. Use their billing address, or the
    country and region you already know. https://docs.helloteak.com/docs/server-offer#send-the-customers-location"""
    location = location if isinstance(location, dict) else {}
    country = str(location.get("country") or "").upper()
    region = str(location.get("region") or "").upper()
    if re.fullmatch(r"[A-Z]{2}", country) and re.fullmatch(r"[A-Z0-9]{1,3}", region):
        return {"country": country, "region": region}
    return None


def to_teak_item(event, reference_id):
    return {
        "name": event["name"],
        "reference_id": reference_id,
        "product_types": [event["productType"]],
        "cost": event["price"],  # a string, including the item's share of taxes and fees
        "event": {"name": event["eventName"], "start_datetime": event["startsAt"], "end_datetime": event["endsAt"]},
    }


def price_items(cart, location, items):
    """Prices items on the cart's session. Returns Teak's prices by reference ID, or None if the
    call failed or timed out: the page then shows without protection."""
    try:
        programs = get_programs(live_session_id(cart), location, items)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cart %s: %s", cart["id"], exc)  # log it, so you can fix the item it names
        return None
    remember_session(cart, programs["session_id"])
    return {item["reference_id"]: item for item in programs["items"]}


@app.get("/")
def search_page():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/checkout")
def checkout_page():
    return send_from_directory(FRONTEND, "checkout.html")


@app.get("/confirmation")
def confirmation_page():
    return send_from_directory(FRONTEND, "confirmation.html")


@app.get("/health")
def health():
    return "ok"


@app.post("/api/search")
def search():
    """Search results, each with its protection price. One call prices the whole page."""
    body = request.get_json(silent=True) or {}
    location = read_location(body.get("location"))
    if not location:
        return jsonify(error="Choose where you are."), 400
    cart = get_cart(body.get("cartId"))

    prices = price_items(cart, location, [to_teak_item(event, event["id"]) for event in EVENTS])
    results = [
        {
            **{k: event[k] for k in ("id", "name", "venue", "price", "startsAt")},
            "protectionPrice": (prices or {}).get(event["id"], {}).get("estimated_premium"),
        }
        for event in EVENTS
    ]
    return jsonify(cartId=cart["id"], coverage=COVERAGE, results=results)


@app.post("/api/cart")
def price_cart():
    """The cart, priced again on the same session. One Teak item per ticket."""
    body = request.get_json(silent=True) or {}
    location = read_location(body.get("location"))
    cart = carts.get(body.get("cartId"))
    if not location or not cart:
        return jsonify(error="Start from the search page."), 400

    quantities = body.get("quantities") or {}
    lines = [
        (event, quantities.get(event["id"]))
        for event in EVENTS
        if type(quantities.get(event["id"])) is int and 0 < quantities.get(event["id"]) <= 10
    ]
    if not lines:
        return jsonify(error="Add a ticket."), 400

    teak_items = [to_teak_item(event, f"{event['id']}-{i + 1}") for event, quantity in lines for i in range(quantity)]
    prices = price_items(cart, location, teak_items)
    protection = sum((Decimal(prices.get(item["reference_id"], {}).get("estimated_premium", "0")) for item in teak_items), Decimal(0)) if prices else Decimal(0)

    cart.update(
        location=location,
        lines=[{"id": event["id"], "name": event["name"], "price": event["price"], "quantity": quantity} for event, quantity in lines],
        teak_items=[item["reference_id"] for item in teak_items] if prices else [],
        protection_total=money(protection) if prices and protection > 0 else None,
    )
    subtotal = sum((Decimal(line["price"]) * line["quantity"] for line in cart["lines"]), Decimal(0))
    return jsonify(coverage=COVERAGE, lines=cart["lines"], subtotal=money(subtotal), protectionTotal=cart["protection_total"])


@app.post("/api/checkout")
def checkout():
    body = request.get_json(silent=True) or {}
    cart = carts.get(body.get("cartId"))
    customer = body.get("customer") or {}
    if not cart or not cart.get("lines") or not all(customer.get(k) for k in ("first_name", "last_name", "email")):
        return jsonify(error="Add a ticket and fill in your details."), 400
    accepted = body.get("accepted") is True
    offered = bool(cart["protection_total"])
    protected_order = offered and (COVERAGE == "embedded" or accepted)

    # Create and charge the order in your system first. This example only records it.
    order = {
        "number": f"ORD-{int(time.time() * 1000)}-{secrets.randbelow(9000) + 1000}",
        "lines": cart["lines"],
        "customer": {k: customer[k] for k in ("first_name", "last_name", "email")},
        "protection_price": cart["protection_total"] if protected_order else None,
        "protection": "pending" if offered else "not-offered",
    }
    orders[order["number"]] = order
    session_id = live_session_id(cart)
    choices = [{"referenceId": ref, "accepted": accepted} for ref in cart["teak_items"]] if COVERAGE == "optional" else []

    # A session covers one purchase. Start the next one fresh, whatever Teak responds.
    carts.pop(cart["id"], None)

    # The customer's order is complete. Confirm it with Teak in the background, so retries never
    # hold up checkout, and a Teak failure never fails the order. In production, use a task queue.
    if offered and session_id:
        threading.Thread(target=confirm_in_background, args=(session_id, choices, order), daemon=True).start()
    return jsonify(orderNumber=order["number"])


def confirm_in_background(session_id, choices, order):
    try:
        order["protection"] = confirm_teak_order(session_id, choices, order)
    except ConfirmNotSetUpError as exc:
        order["protection"] = "not-set-up"
        logger.error("Order %s: %s", order["number"], exc)
    except Exception:
        order["protection"] = "failed"
        logger.exception("Order %s: Teak confirm failed", order["number"])  # alert your team


@app.get("/api/orders/<number>")
def get_order(number):
    order = orders.get(number)
    if not order:
        return "", 404
    return jsonify(orderNumber=order["number"], protection=order["protection"], protectionPrice=order["protection_price"])


if __name__ == "__main__":
    if not os.environ.get("TEAK_PUBLIC_KEY") or not os.environ.get("TEAK_SECRET_KEY"):
        logger.warning("Set TEAK_PUBLIC_KEY and TEAK_SECRET_KEY in .env. See .env.example.")
    app.run(port=int(os.environ.get("PORT", 8080)), debug=True)
