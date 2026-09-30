from __future__ import annotations

import json
import os
import threading
from contextlib import suppress
from pathlib import Path
from typing import Any


class PlannerStore:
    """Small atomic JSON store for one planned itinerary per calendar date."""

    def __init__(self, path: Path | None = None) -> None:
        base = Path(os.getenv("COMMON_DATA_DIR", "common"))
        self.path = path or base / "planner.json"
        self._lock = threading.RLock()

    def list(self, *, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            plans = self._load_unlocked()
            values = [
                dict(plan)
                for plan_date, plan in plans.items()
                if (start is None or plan_date >= start) and (end is None or plan_date <= end)
            ]
            values.sort(key=lambda plan: str(plan.get("date") or ""))
            return values

    def get(self, plan_date: str) -> dict[str, Any] | None:
        with self._lock:
            plan = self._load_unlocked().get(plan_date)
            return dict(plan) if plan is not None else None

    def save(
        self,
        plan_date: str,
        plan: dict[str, Any],
        *,
        replace_existing: bool = False,
    ) -> dict[str, Any]:
        with self._lock:
            plans = self._load_unlocked()
            if plan_date in plans and not replace_existing:
                raise FileExistsError(f"a plan already exists for {plan_date}")
            stored = dict(plan)
            stored["date"] = plan_date
            plans[plan_date] = stored
            self._save_unlocked(plans)
            return dict(stored)

    def delete(self, plan_date: str) -> bool:
        with self._lock:
            plans = self._load_unlocked()
            if plan_date not in plans:
                return False
            del plans[plan_date]
            self._save_unlocked(plans)
            return True

    def _load_unlocked(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(payload, dict):
            return {}
        raw_plans = payload.get("plans")
        if not isinstance(raw_plans, dict):
            return {}
        return {
            key: dict(value)
            for key, value in raw_plans.items()
            if isinstance(key, str) and isinstance(value, dict)
        }

    def _save_unlocked(self, plans: dict[str, dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"plans": plans}, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        with suppress(OSError):
            temporary.chmod(0o600)
        temporary.replace(self.path)
        with suppress(OSError):
            self.path.chmod(0o600)
