"""On-demand Letterboxd community rating for an IMDb-identifiable film.

No bulk scraping: only movies requested in the priority editor are queried.
A cached missing result remains unknown rather than being misrepresented as zero.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlparse

from .provider_cache import ProviderCache

_IMDB_ID = re.compile(r"tt\d{5,12}\Z")
_SUCCESS_TTL = 24 * 60 * 60
_NEGATIVE_TTL = 6 * 60 * 60
_DAILY_BUDGET = 100
_MAX_HTML_BYTES = 2_000_000


class _JsonLdScripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.active = False
        self.parts: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "script":
            return
        attributes = dict(attrs)
        self.active = attributes.get("type", "").lower() == "application/ld+json"
        self.parts = []

    def handle_data(self, data: str) -> None:
        if self.active:
            self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.active:
            self.scripts.append("".join(self.parts))
            self.active = False
            self.parts = []


def _extract_rating(html: str) -> float | None:
    parser = _JsonLdScripts()
    parser.feed(html)
    for script in parser.scripts:
        try:
            data = json.loads(script)
        except (TypeError, ValueError):
            continue
        rating = _rating_from_json(data)
        if rating is not None:
            return rating
    return None


def _rating_from_json(data: object) -> float | None:
    if isinstance(data, list):
        for entry in data:
            result = _rating_from_json(entry)
            if result is not None:
                return result
    if not isinstance(data, dict):
        return None
    kind = data.get("@type")
    if kind in {"Movie", "Film"} or (isinstance(kind, list) and "Movie" in kind):
        aggregate = data.get("aggregateRating")
        if isinstance(aggregate, dict):
            try:
                value = float(aggregate["ratingValue"])
            except (KeyError, TypeError, ValueError):
                value = -1
            if 0 < value <= 5:
                return round(value, 2)
    return _rating_from_json(data.get("@graph")) if "@graph" in data else None


def letterboxd_rating(imdb_id: str, cache: ProviderCache) -> float | None:
    if not _IMDB_ID.fullmatch(imdb_id):
        raise ValueError("imdb_id must be a valid IMDb title ID")

    cache_key = f"imdb:v1:{imdb_id}"
    cached = cache.get_json("letterboxd", cache_key)
    if isinstance(cached, dict) and "rating" in cached:
        value = cached["rating"]
        return float(value) if isinstance(value, (float, int)) else None

    if not cache.begin_request("letterboxd", daily_limit=_DAILY_BUDGET):
        return None

    score: float | None = None
    try:
        request = urllib.request.Request(
            f"https://letterboxd.com/imdb/{imdb_id}/",
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; MovieShowtimePlanner/1.0)",
                "Accept": "text/html",
            },
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            url = urlparse(response.geturl())
            if url.scheme == "https" and url.hostname == "letterboxd.com" and url.path.startswith("/film/"):
                raw = response.read(_MAX_HTML_BYTES + 1)
                if len(raw) <= _MAX_HTML_BYTES:
                    score = _extract_rating(raw.decode("utf-8", errors="replace"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        pass

    cache.set_json(
        "letterboxd",
        cache_key,
        {"rating": score},
        ttl_seconds=_SUCCESS_TTL if score is not None else _NEGATIVE_TTL,
    )
    return score
