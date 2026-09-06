from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    zip_code: str = "85004"
    radius_miles: int = 25
    market_page_limit: int = 50
    cache_ttl_seconds: int = 300

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            zip_code=_zip_code_env("FANDANGO_ZIP_CODE", "85004"),
            radius_miles=_bounded_int_env(
                "FANDANGO_RADIUS_MILES",
                25,
                minimum=1,
                maximum=100,
            ),
            market_page_limit=_positive_int_env("FANDANGO_PAGE_LIMIT", 50),
            cache_ttl_seconds=_positive_int_env("CACHE_TTL_SECONDS", 300),
        )


def _zip_code_env(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()
    if len(value) != 5 or not value.isdigit():
        raise ValueError(f"{name} must be a five-digit US ZIP code")
    return value


def _positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _bounded_int_env(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = _positive_int_env(name, default)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value
