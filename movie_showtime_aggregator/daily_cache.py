from __future__ import annotations

import json
import os
import sqlite3
import threading
from collections.abc import Callable
from datetime import datetime, timedelta
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

    def last_refresh_started(self) -> datetime | None:
        """Persist the automatic/manual refresh cadence across restarts."""
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT started_at FROM refresh_schedule WHERE schedule_id=1"
            ).fetchone()
        if row is None:
            return None
        try:
            started = datetime.fromisoformat(row[0])
            return started if started.tzinfo is not None else None
        except (ValueError, TypeError):
            return None

    def last_refresh_completed(self) -> datetime | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT finished_at FROM refresh_schedule WHERE schedule_id=1"
            ).fetchone()
        if row is None or row[0] is None:
            return None
        try:
            completed = datetime.fromisoformat(row[0])
            return completed if completed.tzinfo is not None else None
        except (ValueError, TypeError):
            return None

    def mark_refresh_completed(self, completed: datetime) -> None:
        if completed.tzinfo is None:
            raise ValueError("Refresh timestamp must have a timezone")
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE refresh_schedule SET finished_at=? WHERE schedule_id=1",
                (completed.isoformat(),),
            )

    def mark_refresh_started(self, started: datetime) -> None:
        if started.tzinfo is None:
            raise ValueError("Refresh timestamp must have a timezone")
        with self._lock, self._connect() as db:
            db.execute(
                """
                INSERT INTO refresh_schedule(schedule_id, started_at, finished_at)
                VALUES(1, ?, NULL)
                ON CONFLICT(schedule_id) DO UPDATE SET
                    started_at=excluded.started_at,
                    finished_at=NULL
                """,
                (started.isoformat(),),
            )

    def replace_prefix(self, namespace: str, prefix: str, key: str, value: object) -> None:
        """Atomically replace a day's response after successful upstream enrichment."""
        if not key.startswith(prefix):
            raise ValueError("Cache key must match the replaced prefix")
        encoded = json.dumps(value, separators=(",", ":"), sort_keys=True)
        with self._lock, self._connect() as db:
            db.execute(
                "DELETE FROM snapshots WHERE namespace=? AND substr(cache_key,1,?)=?",
                (namespace, len(prefix), prefix),
            )
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

    def status(self) -> dict[str, object]:
        with self._lock, self._connect() as db:
            rows = db.execute(
                """
                SELECT namespace, COUNT(*), MAX(saved_at)
                FROM snapshots WHERE snapshot_day=? GROUP BY namespace
                """,
                (self._day(),),
            ).fetchall()
        started = self.last_refresh_started()
        completed = self.last_refresh_completed()
        return {
            "last_refresh_completed_at": completed.isoformat() if completed else None,
            "interrupted_refresh": started is not None
            and (completed is None or completed < started),
            "refresh_interval_hours": 4,
            "last_refresh_started_at": started.isoformat() if started else None,
            "next_refresh_at": ((started + timedelta(hours=4)).isoformat() if started else None),
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
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS refresh_schedule (
                schedule_id INTEGER PRIMARY KEY CHECK (schedule_id=1),
                started_at TEXT NOT NULL,
                finished_at TEXT
            )
            """
        )
        return db
