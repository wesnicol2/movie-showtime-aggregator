"""Poster caching downloads bounded real image bytes and never proxies arbitrary hosts."""

import hashlib
import io

from movie_showtime_aggregator.poster_cache import PosterCache

JPEG = b"\xff\xd8\xff" + b"poster pixels" + b"\xff\xd9"
TRUSTED_URL = "https://m.media-amazon.com/images/M/test-poster.jpg"


class FakeResponse:
    def __init__(self, data):
        self.reader = io.BytesIO(data)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, size):
        return self.reader.read(size)


class FakeOpener:
    def __init__(self, contents=JPEG):
        self.contents = contents
        self.calls = 0

    def open(self, request, timeout):
        assert request.full_url == TRUSTED_URL
        assert timeout <= 4
        self.calls += 1
        return FakeResponse(self.contents)


def test_poster_is_durable_and_downloaded_only_once(tmp_path):
    opener = FakeOpener()
    cache = PosterCache(tmp_path / "posters", opener=opener)
    localized = cache.localize([TRUSTED_URL, TRUSTED_URL])
    digest = hashlib.sha256(TRUSTED_URL.encode()).hexdigest()
    assert localized[TRUSTED_URL] == f"/api/posters/{digest}"
    assert cache.get(digest) == (JPEG, "image/jpeg")
    assert PosterCache(tmp_path / "posters").get(digest) == (JPEG, "image/jpeg")
    assert cache.localize([TRUSTED_URL]) == localized
    assert opener.calls == 1


def test_rejects_nonposter_hosts_bad_protocol_and_bad_bytes(tmp_path):
    opener = FakeOpener()
    cache = PosterCache(tmp_path / "posters", opener=opener)
    assert (
        cache.localize(
            [
                "http://m.media-amazon.com/poster.jpg",
                "https://localhost/poster.jpg",
                "https://127.0.0.1/poster.jpg",
                "https://m.media-amazon.com.evil.com/poster.jpg",
                "https://m.media-amazon.com:8080/poster.jpg",
                "file:///etc/passwd",
            ]
        )
        == {}
    )
    assert opener.calls == 0

    broken = PosterCache(tmp_path / "broken", opener=FakeOpener(b"<script>bad</script>"))
    assert broken.localize([TRUSTED_URL]) == {}
    assert list((tmp_path / "broken").glob("*")) == []


def test_rejects_oversized_image_and_invalid_file_names(tmp_path):
    opener = FakeOpener(JPEG + b"x" * (3 * 1024 * 1024))
    cache = PosterCache(tmp_path / "posters", opener=opener)
    assert cache.localize([TRUSTED_URL]) == {}
    assert cache.get("../data/settings.json") is None
    assert cache.get("z" * 64) is None
