from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    zip_code: str = "85004"
    market_page_limit: int = 50
    cache_ttl_seconds: int = 300

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            zip_code=_zip_code_env("FANDANGO_ZIP_CODE", "85004"),
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
