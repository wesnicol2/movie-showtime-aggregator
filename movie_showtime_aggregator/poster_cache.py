"""Bounded, on-disk poster image cache for known movie-poster CDNs.

No arbitrary remote URLs are proxied: only HTTPS URLs on an explicit CDN
allowlist may be downloaded, and HTTP redirects are rejected.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import urllib.error
import urllib.request
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

MAX_IMAGE_BYTES = 3 * 1024 * 1024
POSTER_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
# Fandango sends direct CDN poster links; OMDb generally uses Amazon's media CDN.
TRUSTED_HOSTS = frozenset({"m.media-amazon.com", "images-na.ssl-images-amazon.com"})
TRUSTED_SUFFIXES = (".fandango.com",)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _image_type(contents: bytes) -> str | None:
    if contents.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if contents.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if contents.startswith(b"RIFF") and contents[8:12] == b"WEBP":
        return "image/webp"
    if contents.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    return None


def _trusted_source(url: str) -> bool:
    if not url or len(url) > 2048:
        return False
    try:
        parsed = urlsplit(url)
        hostname = (parsed.hostname or "").lower()
        return (
            parsed.scheme == "https"
            and parsed.port in (None, 443)
            and parsed.username is None
            and parsed.password is None
            and (hostname in TRUSTED_HOSTS or any(hostname.endswith(s) for s in TRUSTED_SUFFIXES))
        )
    except ValueError:
        return False


class PosterCache:
    def __init__(self, path: Path | None = None, *, opener=None) -> None:
        self.path = path or Path(os.getenv("DATA_DIR", "data")) / "posters"
        self.opener = opener or urllib.request.build_opener(_NoRedirect)
        self._lock = threading.Lock()
        self._url_locks: dict[str, threading.Lock] = {}

    def localize(self, urls: Iterable[str]) -> dict[str, str]:
        """Prefetch unique posters and return URLs for successfully saved images."""
        unique = {url for url in urls if _trusted_source(url)}
        if not unique:
            return {}
        with ThreadPoolExecutor(max_workers=min(6, len(unique))) as executor:
            results = executor.map(self._cache_one, sorted(unique))
            return {url: local for url, local in results if local}

    def _cache_one(self, url: str) -> tuple[str, str | None]:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
        destination = self.path / digest
        with self._lock:
            url_lock = self._url_locks.setdefault(digest, threading.Lock())
        with url_lock:
            if destination.is_file():
                return url, f"/api/posters/{digest}"
            try:
                request = urllib.request.Request(
                    url,
                    headers={"Accept": "image/jpeg,image/png,image/webp,image/gif"},
                )
                with self.opener.open(request, timeout=4) as response:
                    contents = response.read(MAX_IMAGE_BYTES + 1)
                if len(contents) > MAX_IMAGE_BYTES or _image_type(contents) is None:
                    return url, None
                self.path.mkdir(parents=True, exist_ok=True)
                temporary = self.path / f".{digest}.{threading.get_ident()}.tmp"
                try:
                    temporary.write_bytes(contents)
                    os.replace(temporary, destination)
                finally:
                    temporary.unlink(missing_ok=True)
                return url, f"/api/posters/{digest}"
            except (OSError, TimeoutError, ValueError, urllib.error.URLError):
                return url, None

    def get(self, digest: str) -> tuple[bytes, str] | None:
        if POSTER_PATTERN.fullmatch(digest) is None:
            return None
        try:
            contents = (self.path / digest).read_bytes()
        except OSError:
            return None
        if len(contents) > MAX_IMAGE_BYTES:
            return None
        content_type = _image_type(contents)
        return (contents, content_type) if content_type else None
