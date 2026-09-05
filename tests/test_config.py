import pytest

from movie_showtime_aggregator.config import Settings, parse_theatres


def test_default_theatres_include_phoenix_amcs(monkeypatch):
    monkeypatch.delenv("AMC_THEATRES", raising=False)
    settings = Settings.from_env()

    names = {theatre.name for theatre in settings.theatres}
    assert "AMC Arizona Center 24" in names
    assert "AMC DINE-IN Esplanade 14" in names
    assert "AMC DINE-IN Desert Ridge 18" in names
    assert "AMC Ahwatukee 24" in names


def test_custom_theatres_are_parsed():
    theatres = parse_theatres("AMC One 10:ABC12,AMC Two 12:XYZ34")

    assert [(theatre.name, theatre.fandango_id) for theatre in theatres] == [
        ("AMC One 10", "ABC12"),
        ("AMC Two 12", "XYZ34"),
    ]


def test_invalid_theatre_config_is_rejected():
    with pytest.raises(ValueError, match="AMC_THEATRES"):
        parse_theatres("AMC Missing Id")
