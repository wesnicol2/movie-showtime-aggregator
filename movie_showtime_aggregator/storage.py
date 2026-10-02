from __future__ import annotations

import json
import os
import threading
from contextlib import suppress
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class PersistentSettings:
    home_address: str = ""
    home_display_name: str = ""
    home_latitude: float | None = None
    home_longitude: float | None = None
    amc_vendor_key: str = ""
    omdb_api_key: str = ""
    amc_a_list: bool = False
    experience_deviation_impacts: dict[str, int] = field(default_factory=dict)
    disabled_experience_deviations: tuple[str, ...] = ()

    def public_dict(self) -> dict[str, object]:
        return {
            "home_address": self.home_address,
            "home_display_name": self.home_display_name,
            "home_configured": self.home_latitude is not None and self.home_longitude is not None,
            "amc_vendor_key_set": bool(self.amc_vendor_key),
            "omdb_api_key_set": bool(self.omdb_api_key),
            "amc_a_list": self.amc_a_list,
        }


class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        base = Path(os.getenv("COMMON_DATA_DIR", "common"))
        self.path = path or base / "settings.json"
        self._lock = threading.RLock()

    def load(self) -> PersistentSettings:
        with self._lock:
            if not self.path.exists():
                return PersistentSettings()
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return PersistentSettings()
            return _parse_settings(payload)

    def save(self, settings: PersistentSettings) -> PersistentSettings:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(asdict(settings), indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with suppress(OSError):
                temporary.chmod(0o600)
            temporary.replace(self.path)
            with suppress(OSError):
                self.path.chmod(0o600)
            return settings

    def update(self, **changes: object) -> PersistentSettings:
        with self._lock:
            updated = replace(self.load(), **changes)
            return self.save(updated)


def _parse_settings(payload: object) -> PersistentSettings:
    if not isinstance(payload, dict):
        return PersistentSettings()

    return PersistentSettings(
        home_address=_string(payload.get("home_address")),
        home_display_name=_string(payload.get("home_display_name")),
        home_latitude=_coordinate(payload.get("home_latitude"), -90, 90),
        home_longitude=_coordinate(payload.get("home_longitude"), -180, 180),
        amc_vendor_key=_string(payload.get("amc_vendor_key")),
        omdb_api_key=_string(payload.get("omdb_api_key")),
        amc_a_list=payload.get("amc_a_list") is True,
        experience_deviation_impacts=_experience_impacts(
            payload.get("experience_deviation_impacts")
        ),
        disabled_experience_deviations=_string_tuple(
            payload.get("disabled_experience_deviations")
        ),
    )


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _coordinate(value: Any, minimum: float, maximum: float) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if minimum <= number <= maximum else None


def _experience_impacts(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    impacts: dict[str, int] = {}
    for key, raw_score in value.items():
        if not isinstance(key, str) or not key.strip() or isinstance(raw_score, bool):
            continue
        try:
            score = int(raw_score)
        except (TypeError, ValueError):
            continue
        if -10 <= score <= 10 and score != 0:
            impacts[key.strip()] = score
    return impacts


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(
        dict.fromkeys(item.strip() for item in value if isinstance(item, str) and item.strip())
    )
