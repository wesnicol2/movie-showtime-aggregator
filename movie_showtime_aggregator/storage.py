from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass, replace
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
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
            temporary.replace(self.path)
            try:
                self.path.chmod(0o600)
            except OSError:
                pass
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
