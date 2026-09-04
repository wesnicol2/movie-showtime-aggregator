from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_THEATRES = (
    ("AMC Arizona Center 24", 127),
    ("AMC DINE-IN Esplanade 14", 99),
    ("AMC DINE-IN Desert Ridge 18", 190),
    ("AMC Ahwatukee 24", 94),
)


@dataclass(frozen=True, slots=True)
class Theatre:
    name: str
    theatre_id: int


@dataclass(frozen=True, slots=True)
class Settings:
    vendor_key: str
    theatres: tuple[Theatre, ...]
    preshow_minutes: int = 25
    cache_ttl_seconds: int = 300

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            vendor_key=os.getenv("AMC_VENDOR_KEY", "").strip(),
            theatres=parse_theatres(os.getenv("AMC_THEATRES", "")),
            preshow_minutes=_positive_int_env("AMC_PRESHOW_MINUTES", 25),
            cache_ttl_seconds=_positive_int_env("CACHE_TTL_SECONDS", 300),
        )


def parse_theatres(value: str) -> tuple[Theatre, ...]:
    if not value.strip():
        return tuple(Theatre(name, theatre_id) for name, theatre_id in DEFAULT_THEATRES)

    parsed: list[Theatre] = []
    for part in value.split(","):
        name, separator, raw_id = part.strip().rpartition(":")
        if not separator or not name.strip() or not raw_id.strip().isdigit():
            raise ValueError("AMC_THEATRES must be comma-separated 'Theatre Name:id' entries")
        parsed.append(Theatre(name.strip(), int(raw_id.strip())))

    if not parsed:
        raise ValueError("AMC_THEATRES must contain at least one theatre")
    return tuple(parsed)


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
