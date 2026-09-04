from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

AMC_BASE_URL = "https://api.amctheatres.com/v2"
PAGE_SIZE = 200
MAX_PAGES = 10


class AMCError(RuntimeError):
    pass


class AMCClient:
    def __init__(self, vendor_key: str, *, timeout_seconds: int = 15) -> None:
        self.vendor_key = vendor_key
        self.timeout_seconds = timeout_seconds

    def fetch_showtimes(self, theatre_id: int, show_date: date) -> list[dict[str, object]]:
        if not self.vendor_key:
            raise AMCError("AMC_VENDOR_KEY is not configured")

        showtimes: list[dict[str, object]] = []
        for page_number in range(1, MAX_PAGES + 1):
            payload = self._get_showtime_page(theatre_id, show_date, page_number)
            embedded = payload.get("_embedded", {})
            page_items = embedded.get("showtimes", []) if isinstance(embedded, dict) else []
            if not isinstance(page_items, list):
                raise AMCError("AMC API response did not contain a showtimes list")

            showtimes.extend(item for item in page_items if isinstance(item, dict))
            count = payload.get("count", len(showtimes))
            try:
                total = int(count)
            except (TypeError, ValueError):
                total = len(showtimes)

            if len(showtimes) >= total or not page_items:
                return showtimes

        raise AMCError("AMC API pagination exceeded safety limit")

    def _get_showtime_page(
        self, theatre_id: int, show_date: date, page_number: int
    ) -> dict[str, object]:
        params = urllib.parse.urlencode({"page-number": page_number, "page-size": PAGE_SIZE})
        url = (
            f"{AMC_BASE_URL}/theatres/{theatre_id}/showtimes/{show_date.isoformat()}?{params}"
        )
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "movie-showtime-aggregator/0.1",
                "X-AMC-Vendor-Key": self.vendor_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise AMCError(f"AMC API returned HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise AMCError(f"AMC API request failed: {exc}") from exc

        if not isinstance(payload, dict):
            raise AMCError("AMC API returned an unexpected response")
        return payload
