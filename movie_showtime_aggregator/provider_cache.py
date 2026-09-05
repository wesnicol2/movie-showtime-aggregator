from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any


class ProviderCache:
    def __init__(
        self,
        path: Path | None = None,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        base = Path(os.getenv("COMMON_DATA_DIR", "common"))
        self.path = path or base / "provider-cache.sqlite3"
        self._clock = clock
        self._lock = threading.RLock()

    def get_json(self, provider: str, cache_key: str) -> object | None:
        now = self._clock()
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload, expires_at FROM cache_entries WHERE provider = ? AND cache_key = ?",
                (provider, cache_key),
            ).fetchone()
            if row is None:
                return None
            payload_text, expires_at = row
            if float(expires_at) <= now:
                connection.execute(
                    "DELETE FROM cache_entries WHERE provider = ? AND cache_key = ?",
                    (provider, cache_key),
                )
                return None
            try:
                payload = json.loads(payload_text)
            except (TypeError, json.JSONDecodeError):
                connection.execute(
                    "DELETE FROM cache_entries WHERE provider = ? AND cache_key = ?",
                    (provider, cache_key),
                )
                return None
            self._increment_usage(connection, provider, now, cache_hits=1)
            return payload

    def set_json(self, provider: str, cache_key: str, payload: object, *, ttl_seconds: int) -> None:
        if ttl_seconds <= 0:
            return
        now = self._clock()
        encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO cache_entries(provider, cache_key, payload, expires_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider, cache_key) DO UPDATE SET
                    payload = excluded.payload,
                    expires_at = excluded.expires_at,
                    updated_at = excluded.updated_at
                """,
                (provider, cache_key, encoded, now + ttl_seconds, now),
            )
            connection.execute("DELETE FROM cache_entries WHERE expires_at <= ?", (now,))

    def begin_request(self, provider: str, *, daily_limit: int | None = None) -> bool:
        now = self._clock()
        with self._lock:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                rate_row = connection.execute(
                    "SELECT remaining_value, reset_at FROM rate_state WHERE provider = ?",
                    (provider,),
                ).fetchone()
                if rate_row is not None:
                    remaining, reset_at = rate_row
                    if (
                        remaining is not None
                        and int(remaining) <= 0
                        and reset_at is not None
                        and float(reset_at) > now
                    ):
                        connection.rollback()
                        return False

                day = _utc_day(now)
                usage_row = connection.execute(
                    "SELECT requests FROM usage_daily WHERE provider = ? AND day = ?",
                    (provider, day),
                ).fetchone()
                requests = int(usage_row[0]) if usage_row is not None else 0
                if daily_limit is not None and requests >= daily_limit:
                    connection.rollback()
                    return False

                self._increment_usage(connection, provider, now, requests=1)
                connection.commit()
                return True
            finally:
                connection.close()

    def observe_headers(self, provider: str, headers: Mapping[str, Any] | None) -> None:
        normalized = _normalized_headers(headers)
        if not normalized:
            return

        now = self._clock()
        limit_value = _header_int(
            normalized,
            "x-ratelimit-limit",
            "ratelimit-limit",
            "x-rate-limit-limit",
        )
        remaining_value = _header_int(
            normalized,
            "x-ratelimit-remaining",
            "ratelimit-remaining",
            "x-rate-limit-remaining",
        )
        reset_at = _reset_at(normalized, now)
        if limit_value is None and remaining_value is None and reset_at is None:
            return

        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO rate_state(provider, limit_value, remaining_value, reset_at, observed_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    limit_value = COALESCE(excluded.limit_value, rate_state.limit_value),
                    remaining_value = COALESCE(excluded.remaining_value, rate_state.remaining_value),
                    reset_at = COALESCE(excluded.reset_at, rate_state.reset_at),
                    observed_at = excluded.observed_at
                """,
                (provider, limit_value, remaining_value, reset_at, now),
            )

    def status(
        self, provider: str, *, published_daily_limit: int | None = None
    ) -> dict[str, object]:
        now = self._clock()
        day = _utc_day(now)
        with self._lock, self._connect() as connection:
            usage_row = connection.execute(
                "SELECT requests, cache_hits FROM usage_daily WHERE provider = ? AND day = ?",
                (provider, day),
            ).fetchone()
            rate_row = connection.execute(
                """
                SELECT limit_value, remaining_value, reset_at, observed_at
                FROM rate_state
                WHERE provider = ?
                """,
                (provider,),
            ).fetchone()

        requests = int(usage_row[0]) if usage_row is not None else 0
        cache_hits = int(usage_row[1]) if usage_row is not None else 0
        app_reset = _next_utc_midnight(now)
        published_remaining = None
        published_percent = None
        if published_daily_limit is not None and published_daily_limit > 0:
            published_remaining = max(0, published_daily_limit - requests)
            published_percent = round(100 * requests / published_daily_limit, 1)

        provider_rate_limit = None
        if rate_row is not None:
            limit_value, remaining_value, reset_at, observed_at = rate_row
            percent_used = None
            if limit_value is not None and remaining_value is not None and int(limit_value) > 0:
                percent_used = round(
                    100 * (int(limit_value) - int(remaining_value)) / int(limit_value),
                    1,
                )
            provider_rate_limit = {
                "limit": int(limit_value) if limit_value is not None else None,
                "remaining": int(remaining_value) if remaining_value is not None else None,
                "percent_used": percent_used,
                "reset_at": _iso_utc(float(reset_at)) if reset_at is not None else None,
                "observed_at": _iso_utc(float(observed_at)),
            }

        return {
            "provider": provider,
            "requests_today": requests,
            "cache_hits_today": cache_hits,
            "published_daily_limit": published_daily_limit,
            "estimated_remaining_today": published_remaining,
            "published_percent_used": published_percent,
            "app_counter_reset_at": _iso_utc(app_reset),
            "provider_rate_limit": provider_rate_limit,
        }

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS cache_entries (
                provider TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                payload TEXT NOT NULL,
                expires_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                PRIMARY KEY(provider, cache_key)
            );

            CREATE TABLE IF NOT EXISTS usage_daily (
                provider TEXT NOT NULL,
                day TEXT NOT NULL,
                requests INTEGER NOT NULL DEFAULT 0,
                cache_hits INTEGER NOT NULL DEFAULT 0,
                updated_at REAL NOT NULL,
                PRIMARY KEY(provider, day)
            );

            CREATE TABLE IF NOT EXISTS rate_state (
                provider TEXT PRIMARY KEY,
                limit_value INTEGER,
                remaining_value INTEGER,
                reset_at REAL,
                observed_at REAL NOT NULL
            );
            """
        )
        return connection

    @staticmethod
    def _increment_usage(
        connection: sqlite3.Connection,
        provider: str,
        now: float,
        *,
        requests: int = 0,
        cache_hits: int = 0,
    ) -> None:
        connection.execute(
            """
            INSERT INTO usage_daily(provider, day, requests, cache_hits, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(provider, day) DO UPDATE SET
                requests = usage_daily.requests + excluded.requests,
                cache_hits = usage_daily.cache_hits + excluded.cache_hits,
                updated_at = excluded.updated_at
            """,
            (provider, _utc_day(now), requests, cache_hits, now),
        )


def _normalized_headers(headers: Mapping[str, Any] | None) -> dict[str, str]:
    if headers is None:
        return {}
    return {str(key).casefold(): str(value).strip() for key, value in headers.items()}


def _header_int(headers: dict[str, str], *names: str) -> int | None:
    for name in names:
        raw = headers.get(name)
        if raw is None:
            continue
        try:
            value = int(raw)
        except ValueError:
            continue
        if value >= 0:
            return value
    return None


def _reset_at(headers: dict[str, str], now: float) -> float | None:
    for name in ("x-ratelimit-reset", "ratelimit-reset", "x-rate-limit-reset"):
        raw = headers.get(name)
        parsed = _numeric_reset(raw, now)
        if parsed is not None:
            return parsed

    retry_after = headers.get("retry-after")
    if retry_after is None:
        return None
    parsed = _numeric_reset(retry_after, now, always_delta=True)
    if parsed is not None:
        return parsed
    try:
        parsed_date = parsedate_to_datetime(retry_after)
    except (TypeError, ValueError):
        return None
    if parsed_date.tzinfo is None:
        parsed_date = parsed_date.replace(tzinfo=UTC)
    return parsed_date.timestamp()


def _numeric_reset(raw: str | None, now: float, *, always_delta: bool = False) -> float | None:
    if raw is None:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value < 0:
        return None
    if always_delta or value < 1_000_000_000:
        return now + value
    return value


def _utc_day(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).date().isoformat()


def _next_utc_midnight(timestamp: float) -> float:
    now = datetime.fromtimestamp(timestamp, UTC)
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    return tomorrow.timestamp()


def _iso_utc(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).isoformat().replace("+00:00", "Z")
