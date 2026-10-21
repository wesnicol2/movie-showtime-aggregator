from __future__ import annotations

import json
import os
import sqlite3
import threading
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

PHOENIX = ZoneInfo("America/Phoenix")


def cache_day() -> str:
    """The app's calendar is based on Phoenix local dates, not UTC midnight."""
    return datetime.now(PHOENIX).date().isoformat()


class DailyCache:
    """Durable, date-versioned JSON snapshots; old entries are never served as fresh."""

    def __init__(
        self,
        path: Path | None = None,
        *,
        day: Callable[[], str] = cache_day,
    ) -> None:
        self.path = path or Path(os.getenv("DATA_DIR", "data")) / "daily-showtimes.sqlite3"
        self._day = day
        self._lock = threading.RLock()

    def get(self, namespace: str, key: str) -> Any | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT value, snapshot_day FROM snapshots WHERE namespace=? AND cache_key=?",
                (namespace, key),
            ).fetchone()
        if row is None or row[1] != self._day():
            return None
        try:
            return json.loads(row[0])
        except (TypeError, json.JSONDecodeError):
            return None

    def set(self, namespace: str, key: str, value: object) -> None:
        encoded = json.dumps(value, separators=(",", ":"), sort_keys=True)
        with self._lock, self._connect() as db:
            db.execute(
                """
                INSERT INTO snapshots(namespace, cache_key, value, snapshot_day, saved_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(namespace, cache_key) DO UPDATE SET
                  value=excluded.value, snapshot_day=excluded.snapshot_day,
                  saved_at=excluded.saved_at
                """,
                (namespace, key, encoded, self._day(), datetime.now(PHOENIX).isoformat()),
            )
            db.execute(
                "DELETE FROM snapshots WHERE snapshot_day < ?",
                (self._day(),),
            )

    def delete_prefix(self, namespace: str, prefix: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "DELETE FROM snapshots WHERE namespace=? AND substr(cache_key,1,?)=?",
                (namespace, len(prefix), prefix),
            )

    def remember_profile(self, zip_code: str, radius: int, previews: dict[str, int]) -> None:
        """Persist the last browser location so daily warming uses actual preferences."""
        with self._lock, self._connect() as db:
            db.execute(
                """
                INSERT INTO warm_profile(profile_id, zip_code, radius, previews)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(profile_id) DO UPDATE SET
                    zip_code=excluded.zip_code, radius=excluded.radius,
                    previews=excluded.previews
                """,
                (zip_code, radius, json.dumps(previews, sort_keys=True)),
            )

    def last_profile(self) -> tuple[str, int, dict[str, int]] | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT zip_code, radius, previews FROM warm_profile WHERE profile_id=1"
            ).fetchone()
        if row is None:
            return None
        try:
            previews = json.loads(row[2])
        except (TypeError, json.JSONDecodeError):
            previews = {}
        if not isinstance(previews, dict):
            previews = {}
        return str(row[0]), int(row[1]), previews

    def status(self) -> dict[str, object]:
        with self._lock, self._connect() as db:
            rows = db.execute(
                """
                SELECT namespace, COUNT(*), MAX(saved_at)
                FROM snapshots WHERE snapshot_day=? GROUP BY namespace
                """,
                (self._day(),),
            ).fetchall()
        return {
            "day": self._day(),
            "base_dates": next((count for name, count, _ in rows if name == "base"), 0),
            "responses": next((count for name, count, _ in rows if name == "responses"), 0),
            "updated_at": max((last for _, _, last in rows if last), default=None),
        }

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        db.execute("PRAGMA busy_timeout = 15000")
        db.execute("PRAGMA journal_mode = WAL")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
                namespace TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                value TEXT NOT NULL,
                snapshot_day TEXT NOT NULL,
                saved_at TEXT NOT NULL,
                PRIMARY KEY(namespace, cache_key)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS warm_profile (
                profile_id INTEGER PRIMARY KEY CHECK (profile_id=1),
                zip_code TEXT NOT NULL,
                radius INTEGER NOT NULL,
                previews TEXT NOT NULL
            )
            """
        )
        return db
