from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

OMDB_BASE_URL = "https://www.omdbapi.com/"
USER_AGENT = "movie-showtime-aggregator/1.0"


class MetadataError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MovieMetadata:
    title: str
    poster_url: str = ""
    imdb_id: str = ""
    imdb_rating: float | None = None
    metacritic_score: int | None = None
    rotten_tomatoes_score: int | None = None

    @property
    def imdb_url(self) -> str:
        return f"https://www.imdb.com/title/{self.imdb_id}/" if self.imdb_id else ""

    @property
    def letterboxd_url(self) -> str:
        if self.imdb_id:
            return f"https://letterboxd.com/imdb/{self.imdb_id}/"
        return f"https://letterboxd.com/search/{urllib.parse.quote(self.title)}/"

    @property
    def rotten_tomatoes_url(self) -> str:
        return f"https://www.rottentomatoes.com/search?search={urllib.parse.quote(self.title)}"

    @property
    def metacritic_url(self) -> str:
        return f"https://www.metacritic.com/search/{urllib.parse.quote(self.title)}/"


class OmdbClient:
    def __init__(self, api_key: str, *, timeout_seconds: int = 10) -> None:
        self.api_key = api_key.strip()
        self.timeout_seconds = timeout_seconds
        self._cache: dict[str, MovieMetadata] = {}
        self._lock = threading.Lock()

    def lookup(self, title: str) -> MovieMetadata:
        normalized = " ".join(title.split()).strip()
        if not normalized:
            raise ValueError("movie title is required")
        if not self.api_key:
            raise MetadataError("OMDb API key is not configured")

        cache_key = normalized.casefold()
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        params = urllib.parse.urlencode(
            {
                "apikey": self.api_key,
                "t": normalized,
                "type": "movie",
                "plot": "short",
                "r": "json",
            }
        )
        request = urllib.request.Request(
            f"{OMDB_BASE_URL}?{params}",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise MetadataError(f"OMDb returned HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise MetadataError(f"OMDb request failed: {exc}") from exc

        metadata = _parse_payload(payload, normalized)
        with self._lock:
            self._cache[cache_key] = metadata
        return metadata


def _parse_payload(payload: object, title: str) -> MovieMetadata:
    if not isinstance(payload, dict):
        raise MetadataError("OMDb returned an unexpected response")
    if str(payload.get("Response") or "").casefold() != "true":
        return MovieMetadata(title=title)

    resolved_title = str(payload.get("Title") or title).strip() or title
    poster = str(payload.get("Poster") or "").strip()
    if poster.casefold() == "n/a":
        poster = ""

    rotten_tomatoes = None
    ratings = payload.get("Ratings")
    if isinstance(ratings, list):
        for rating in ratings:
            if not isinstance(rating, dict):
                continue
            if str(rating.get("Source") or "").casefold() == "rotten tomatoes":
                rotten_tomatoes = _percent(rating.get("Value"))
                break

    return MovieMetadata(
        title=resolved_title,
        poster_url=poster,
        imdb_id=_imdb_id(payload.get("imdbID")),
        imdb_rating=_float_or_none(payload.get("imdbRating"), minimum=0, maximum=10),
        metacritic_score=_int_or_none(payload.get("Metascore"), minimum=0, maximum=100),
        rotten_tomatoes_score=rotten_tomatoes,
    )


def _imdb_id(value: object) -> str:
    text = str(value or "").strip()
    return text if text.startswith("tt") and text[2:].isdigit() else ""


def _percent(value: object) -> int | None:
    text = str(value or "").strip().removesuffix("%")
    return _int_or_none(text, minimum=0, maximum=100)


def _int_or_none(value: object, *, minimum: int, maximum: int) -> int | None:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if minimum <= number <= maximum else None


def _float_or_none(value: object, *, minimum: float, maximum: float) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if minimum <= number <= maximum else None
