from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_THEATRES = (
    ("AMC Arizona Center 24", "AAECS"),
    ("AMC DINE-IN Esplanade 14", "AAECR"),
    ("AMC DINE-IN Desert Ridge 18", "AAPGJ"),
    ("AMC Ahwatukee 24", "AACGT"),
)


@dataclass(frozen=True, slots=True)
class Theatre:
    name: str
    fandango_id: str


@dataclass(frozen=True, slots=True)
class Settings:
    theatres: tuple[Theatre, ...]
    preshow_minutes: int = 25
    cache_ttl_seconds: int = 300

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            theatres=parse_theatres(os.getenv("AMC_THEATRES", "")),
            preshow_minutes=_positive_int_env("AMC_PRESHOW_MINUTES", 25),
            cache_ttl_seconds=_positive_int_env("CACHE_TTL_SECONDS", 300),
        )


def parse_theatres(value: str) -> tuple[Theatre, ...]:
    if not value.strip():
        return tuple(Theatre(name, fandango_id) for name, fandango_id in DEFAULT_THEATRES)

    parsed: list[Theatre] = []
    for part in value.split(","):
        name, separator, raw_id = part.strip().rpartition(":")
        fandango_id = raw_id.strip().upper()
        if not separator or not name.strip() or not fandango_id.isalnum():
            raise ValueError("AMC_THEATRES must be comma-separated 'Theatre Name:FandangoId' entries")
        parsed.append(Theatre(name.strip(), fandango_id))

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
