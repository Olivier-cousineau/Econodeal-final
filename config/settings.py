"""Global configuration helpers for the scraping and API utilities."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _default_user_agents() -> List[str]:
    return [
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
    ]


def _default_proxy_pool() -> List[str]:
    return []


def _default_walmart_headers() -> Dict[str, str]:
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Connection": "keep-alive",
    }


class Settings(BaseSettings):
    """Container for runtime configuration values.

    The settings are purposely resilient: most fields have sane defaults so the
    tooling keeps functioning during local development.  Environment variables
    can override any of the attributes using the usual ``pydantic-settings``
    conventions.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    base_dir: Path = Field(default_factory=_project_root)
    data_dir: Path = Field(default_factory=lambda: _project_root() / "data")
    logs_dir: Path = Field(default_factory=lambda: _project_root() / "logs")

    bestbuy_clearance_url: str = Field(
        default=(
            "https://www.bestbuy.ca/en-ca/collection/clearance-products/113065"
        )
    )
    bestbuy_show_more_selector: str = Field(
        default=(
            "button[data-automation='load-more-button'], "
            "button[data-automation='show-more-button']"
        )
    )
    bestbuy_user_agents: List[str] = Field(default_factory=_default_user_agents)
    bestbuy_proxy_pool: List[str] = Field(default_factory=_default_proxy_pool)
    bestbuy_random_delay_min: float = Field(default=1.5)
    bestbuy_random_delay_max: float = Field(default=3.5)
    selenium_implicit_wait: float = Field(default=10.0)
    selenium_page_load_timeout: float = Field(default=75.0)

    stripe_secret_key: str | None = None
    stripe_publishable_key: str | None = None
    stripe_publishable_key_candidates: Sequence[str] = Field(
        default=(
            "STRIPE_PUBLISHABLE_KEY",
            "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
            "STRIPE_PUBLIC_KEY",
        )
    )
    stripe_success_url: str = Field(
        default="https://econo.app/pricing?status=success"
    )
    stripe_cancel_url: str = Field(
        default="https://econo.app/pricing?status=cancelled"
    )

    walmart_source_file: Path = Field(
        default_factory=lambda: _project_root()
        / "data"
        / "walmart"
        / "walmart_liquidation.json"
    )
    walmart_store_id: int = Field(default=1076)
    walmart_api_base: str = Field(
        default="https://www.walmart.ca/api/product-page/v2"
    )
    walmart_request_timeout: float = Field(default=15.0)
    walmart_headers: Dict[str, str] = Field(default_factory=_default_walmart_headers)

    penny_deal_output_file: Path = Field(
        default_factory=lambda: _project_root()
        / "logs"
        / "walmart-penny-deals.json"
    )

    @staticmethod
    def _split_candidates(raw: str) -> List[str]:
        separators = [",", "\n", "\r", ";"]
        candidates: List[str] = [raw]
        for separator in separators:
            next_candidates: List[str] = []
            for candidate in candidates:
                if separator in candidate:
                    next_candidates.extend(candidate.split(separator))
                else:
                    next_candidates.append(candidate)
            candidates = next_candidates
        return [item.strip() for item in candidates if item and item.strip()]

    @field_validator("bestbuy_user_agents", mode="before")
    @classmethod
    def _parse_user_agents(cls, value: object) -> Iterable[str] | object:
        if value is None or isinstance(value, (list, tuple, set)):
            return value
        if isinstance(value, str):
            return cls._split_candidates(value)
        return value

    @field_validator("bestbuy_proxy_pool", mode="before")
    @classmethod
    def _parse_proxy_pool(cls, value: object) -> Iterable[str] | object:
        if value is None or isinstance(value, (list, tuple, set)):
            return value
        if isinstance(value, str):
            return cls._split_candidates(value)
        return value

    @field_validator("stripe_publishable_key_candidates", mode="before")
    @classmethod
    def _parse_publishable_candidates(cls, value: object) -> Sequence[str] | object:
        if value is None or isinstance(value, (list, tuple, set)):
            return value
        if isinstance(value, str):
            return tuple(cls._split_candidates(value))
        return value

    @field_validator("walmart_headers", mode="before")
    @classmethod
    def _parse_walmart_headers(cls, value: object) -> Dict[str, str] | object:
        if value is None or isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                pairs = cls._split_candidates(value)
                headers: Dict[str, str] = {}
                for pair in pairs:
                    if "=" in pair:
                        key, val = pair.split("=", 1)
                        headers[key.strip()] = val.strip()
                return headers
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items()}
        return value

    @property
    def bestbuy_user_agent(self) -> str:
        return (self.bestbuy_user_agents[0] if self.bestbuy_user_agents else "Mozilla/5.0")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings to avoid repeated filesystem access."""

    try:
        return Settings()
    except Exception:
        fallback = Settings.model_construct()
        if not fallback.bestbuy_user_agents:
            fallback.bestbuy_user_agents = _default_user_agents()
        return fallback

