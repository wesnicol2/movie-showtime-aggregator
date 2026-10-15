"""Build metadata is authoritative for images and never guessed."""

from movie_showtime_aggregator.build_info import UNKNOWN, build_info


def test_deployed_image_stamp(monkeypatch):
    monkeypatch.setenv("APP_COMMIT", "a" * 40)
    monkeypatch.setenv("APP_BRANCH", "feature/amc-ticket-links")
    monkeypatch.setenv("APP_IMAGE_TAG", "test")
    monkeypatch.setenv("APP_COMMIT_AT", "2026-10-15T01:32:00+00:00")
    monkeypatch.setenv("APP_BUILT_AT", "2026-10-15T01:34:00Z")
    build_info.cache_clear()
    try:
        info = build_info()
        assert info["source"] == "image"
        assert info["commit"] == "a" * 40
        assert info["commit_short"] == "aaaaaaa"
        assert info["branch"] == "feature/amc-ticket-links"
        assert info["image_tag"] == "test"
        assert info["commit_at"] == "2026-10-15T01:32:00+00:00"
        assert info["built_at"] == "2026-10-15T01:34:00Z"
    finally:
        build_info.cache_clear()


def test_unstamped_image_reports_unknown(monkeypatch):
    monkeypatch.setenv("APP_COMMIT", "unknown")
    monkeypatch.setenv("APP_IMAGE_TAG", "")
    build_info.cache_clear()
    try:
        info = build_info()
        # In CI a Git checkout is present; never misrepresent it as an image stamp.
        assert info["source"] != "image"
        assert info["image_tag"] is None
        if info["commit"] == UNKNOWN:
            assert info["commit_short"] == UNKNOWN
    finally:
        build_info.cache_clear()
