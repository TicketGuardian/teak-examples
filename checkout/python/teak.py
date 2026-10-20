"""The Teak Partner API calls this example makes: an access token, Submit an order,
and Retrieve order details. https://docs.helloteak.com/reference"""
import os
import time
from urllib.parse import quote

import requests

TEAK_API = os.environ.get("TEAK_API_BASE") or "https://api.sandbox.helloteak.com/v1"


def get_teak_token():
    """Tokens expire after 5 minutes, so get a new one for each call rather than caching it."""
    res = requests.post(
        f"{TEAK_API}/auth/token",
        json={
            "public_key": os.environ.get("TEAK_PUBLIC_KEY"),
            "secret_key": os.environ.get("TEAK_SECRET_KEY"),
        },
        timeout=10,
    )
    res.raise_for_status()
    return res.json()["token"]


def submit_teak_order(session_id, order):
    """Submit the order, retrying where it's safe to. From the "Submit an order reliably" recipe.

    Returns "submitted" or "opted-out", or raises."""
    body = {
        "reference_id": order["number"],  # your order number, unique per order
        "customer": order["customer"],  # {first_name, last_name, email}
        "payment": {"type": "invoice"},
    }

    last_error = None
    for delay in (0, 1, 5, 30):
        time.sleep(delay)
        try:
            res = requests.post(
                f"{TEAK_API}/orders/{quote(session_id, safe='')}/submit",
                json=body,
                headers={"Authorization": f"Bearer {get_teak_token()}"},
                timeout=10,
            )
        except requests.RequestException as exc:
            last_error = exc
            continue

        if res.status_code == 202:
            return "submitted"
        if res.status_code == 204:
            return "opted-out"
        if res.status_code == 401:
            continue

        # Most errors are HTTP 400 with the real code in error.code.
        try:
            error = res.json().get("error") or {}
        except ValueError:
            error = {}
        if error.get("code") == 409:
            return "submitted"  # already submitted, e.g. by an earlier attempt
        if error.get("code") == 503:
            continue

        raise RuntimeError(f"Teak submit failed: {res.status_code} {error or res.text}")
    raise RuntimeError("Teak submit failed after retries") from last_error


def get_protection_links(order_number, email):
    """The customer's protection links, one entry per protection product on the order.

    Returns None while the order is still being created (404)."""
    res = requests.get(
        f"{TEAK_API}/orders/{quote(order_number, safe='')}/details",
        params={"email": email},
        headers={"Authorization": f"Bearer {get_teak_token()}"},
        timeout=10,
    )
    if res.status_code == 404:
        return None
    res.raise_for_status()

    return [
        {
            "product": product["product_slug"],
            "certificate": product["links"]["certificate_url"],
            "terms": product["links"]["policy_pdf"],
            "refund": product["links"]["refund_request_url"],
            "cancel": product["links"]["cancellation_url"],
        }
        for product in res.json()["primary_policies"]
    ]
