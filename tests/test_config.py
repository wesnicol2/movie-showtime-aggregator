import pytest

from movie_showtime_aggregator.config import Settings


def test_default_market_is_phoenix(monkeypatch):
    monkeypatch.delenv("FANDANGO_ZIP_CODE", raising=False)
    monkeypatch.delenv("FANDANGO_RADIUS_MILES", raising=False)
    monkeypatch.delenv("FANDANGO_PAGE_LIMIT", raising=False)
    monkeypatch.delenv("CACHE_TTL_SECONDS", raising=False)

    settings = Settings.from_env()

    assert settings.zip_code == "85004"
    assert settings.radius_miles == 25
    assert settings.market_page_limit == 50
    assert settings.cache_ttl_seconds == 300


def test_market_settings_can_be_overridden(monkeypatch):
    monkeypatch.setenv("FANDANGO_ZIP_CODE", "85281")
    monkeypatch.setenv("FANDANGO_RADIUS_MILES", "40")
    monkeypatch.setenv("FANDANGO_PAGE_LIMIT", "25")
    monkeypatch.setenv("CACHE_TTL_SECONDS", "120")

    settings = Settings.from_env()

    assert settings.zip_code == "85281"
    assert settings.radius_miles == 40
    assert settings.market_page_limit == 25
    assert settings.cache_ttl_seconds == 120


def test_invalid_zip_is_rejected(monkeypatch):
    monkeypatch.setenv("FANDANGO_ZIP_CODE", "Phoenix")

    with pytest.raises(ValueError, match="five-digit US ZIP"):
        Settings.from_env()


def test_invalid_radius_is_rejected(monkeypatch):
    monkeypatch.setenv("FANDANGO_RADIUS_MILES", "101")

    with pytest.raises(ValueError, match="between 1 and 100"):
        Settings.from_env()


def test_invalid_page_limit_is_rejected(monkeypatch):
    monkeypatch.setenv("FANDANGO_PAGE_LIMIT", "0")

    with pytest.raises(ValueError, match="greater than zero"):
        Settings.from_env()
