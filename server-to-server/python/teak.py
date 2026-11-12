"""The Teak Partner API calls this example makes: an access token, Get programs, and the
Confirm the order step. https://docs.helloteak.com/docs/server-to-server-guide"""
import os
import time

import requests

TEAK_API = os.environ.get("TEAK_API_BASE") or "https://api.sandbox.helloteak.com/v1"

# This server calls Teak on every search, so it reuses one access token until it's close to
# expiring. Tokens last 5 minutes. https://docs.helloteak.com/docs/environments-and-keys#reuse-the-token
_cached = {"token": None, "expires_at": 0.0}


def get_teak_token():
    # Renew a minute early, so a token never expires mid-request.
    if _cached["token"] and time.time() < _cached["expires_at"] - 60:
        return _cached["token"]
    res = requests.post(
        f"{TEAK_API}/auth/token",
        json={
            "public_key": os.environ.get("TEAK_PUBLIC_KEY"),
            "secret_key": os.environ.get("TEAK_SECRET_KEY"),
        },
        timeout=10,
    )
    res.raise_for_status()
    _cached.update(token=res.json()["token"], expires_at=time.time() + 5 * 60)
    return _cached["token"]


def get_programs(session_id, location, items):
    """Get programs: a protection price for each item, on the purchase's session.

    Leave session_id out on the first call, and Teak starts a session.
    https://docs.helloteak.com/docs/server-offer"""
    body = {
        "currency": "USD",
        "locale": "en_US",
        "location": location,  # {"country": "US", "region": "TX"}: strongly preferred over ip_address or phone_number
        "items": items,
    }
    if session_id:
        body["session_id"] = session_id

    def send():
        return requests.post(
            f"{TEAK_API}/programs",
            json=body,
            headers={"Authorization": f"Bearer {get_teak_token()}"},
            timeout=2,  # a protection price must never hold up the page
        )

    res = send()
    if res.status_code == 401:
        _cached["token"] = None  # rejected token: get a new one and retry once
        res = send()
    # One bad item fails the whole call, and the error names it.
    if not res.ok:
        raise RuntimeError(f"Teak Get programs failed: {res.status_code} {res.text}")
    return res.json()


class ConfirmNotSetUpError(Exception):
    pass


def confirm_teak_order(session_id, choices, order):
    """Confirm the order: record the customer's choices and place the order with Teak.

    Your Teak integration contact gives you the calls for this step during onboarding. Put them
    here. Everything else in this example stays the same.
    https://docs.helloteak.com/docs/server-confirm-the-order

      session_id  the session from Get programs
      choices     [{"referenceId", "accepted"}], one per optional item. Embedded protection is added by Teak.
      order       {"number", "customer": {first_name, last_name, email}}: the person booking

    Return "placed" when Teak accepts the order (202) or says it was already placed, and
    "declined" when nothing is protected (204). Retry 401 with a new token, and 503 with backoff,
    on the same session. Raise on anything else."""
    raise ConfirmNotSetUpError(
        "Confirm the order isn't set up yet: add the calls from your Teak integration contact "
        "to confirm_teak_order() in teak.py."
    )
