from __future__ import annotations

from typing import Collection, Dict, Mapping, Optional, Sequence

import os
import stripe

from config.settings import Settings


def ensure_stripe_secret(settings: Settings) -> str:
    secret_key = settings.stripe_secret_key or ""
    if not secret_key:
        raise RuntimeError(
            "STRIPE_SECRET_KEY is not configured. Export it before starting the server."
        )
    return secret_key


def _iter_publishable_candidates(
    settings: Settings,
) -> Sequence[str]:
    if isinstance(settings.stripe_publishable_key_candidates, Sequence):
        return settings.stripe_publishable_key_candidates
    return (
        "STRIPE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        "STRIPE_PUBLIC_KEY",
    )


def get_publishable_key(settings: Settings) -> Optional[str]:
    if settings.stripe_publishable_key:
        return settings.stripe_publishable_key

    for env_var in _iter_publishable_candidates(settings):
        value = os.environ.get(env_var)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def create_checkout_session(
    settings: Settings,
    plan_config: Mapping[str, Mapping[str, object]],
    payload: Mapping[str, object],
    supported_locales: Collection[str],
) -> Dict[str, object]:
    secret = ensure_stripe_secret(settings)
    stripe.api_key = secret

    plan_key = payload.get("plan")
    config = plan_config.get(str(plan_key)) if plan_key is not None else None
    if not config:
        raise ValueError("Unknown pricing plan.")

    locale_raw = str(payload.get("locale") or "en")
    locale = locale_raw.split("-")[0].lower()
    stripe_locale = locale if locale in supported_locales else "en"

    name = str(payload.get("name") or config.get("default_name") or "").strip()
    if not name:
        name = str(config.get("default_name") or "Essential plan")

    description = str(
        payload.get("description") or config.get("default_description") or ""
    ).strip()

    amount = int(config.get("amount") or 0)
    if amount <= 0:
        raise ValueError("Invalid Stripe amount configured for the plan.")

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "cad",
                        "unit_amount": amount,
                        "product_data": {
                            "name": name,
                            "description": description,
                        },
                    },
                }
            ],
            allow_promotion_codes=True,
            locale=stripe_locale,
            success_url=settings.stripe_success_url,
            cancel_url=settings.stripe_cancel_url,
            automatic_tax={"enabled": False},
        )
    except stripe.error.StripeError as exc:  # pragma: no cover - network/API error
        message = exc.user_message or str(exc)
        raise ValueError(message)

    return {"sessionId": session.get("id")}
