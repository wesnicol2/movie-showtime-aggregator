from datetime import date, datetime

from movie_showtime_aggregator.config import Settings
from movie_showtime_aggregator.location import GeoPoint
from movie_showtime_aggregator.models import Screening
from movie_showtime_aggregator.service import (
    ScreeningFilters,
    ScreeningService,
    facets,
    filter_screenings,
)


def screening(
    movie="Movie A",
    theatre="AMC One",
    chain="AMC",
    format_name="Standard",
    advertised="2026-09-04T17:30:00",
    actual="2026-09-04T17:55:00",
    end="2026-09-04T20:00:00",
    distance=5.0,
):
    return Screening(
        showtime_id="1",
        movie=movie,
        theatre=theatre,
        chain=chain,
        format=format_name,
        advertised_start=datetime.fromisoformat(advertised),
        actual_start=datetime.fromisoformat(actual) if actual else None,
        estimated_end=datetime.fromisoformat(end) if end else None,
        runtime_minutes=125,
        distance_miles=distance,
        purchase_url="",
    )


def raw_showtime(
    showtime_id,
    theatre,
    *,
    movie="Movie A",
    chain="AMC",
    zip_code="85004",
    latitude=0,
    longitude=0,
    hour=18,
):
    return {
        "id": showtime_id,
        "movieName": movie,
        "theatreName": theatre,
        "chainName": chain,
        "theatreZip": zip_code,
        "theatreLatitude": latitude,
        "theatreLongitude": longitude,
        "showDateTimeLocal": f"2026-09-04T{hour:02d}:00:00",
        "runTime": 100,
        "premiumFormat": "",
        "isCanceled": False,
        "isSoldOut": False,
        "isExpired": False,
    }


def test_filter_by_movie_theatre_and_format():
    screenings = [
        screening(),
        screening(
            movie="Movie B",
            theatre="Harkins One",
            chain="Harkins Theatres",
            format_name="IMAX",
        ),
    ]
    filters = ScreeningFilters(
        movies=frozenset({"Movie B"}),
        theatres=frozenset({"Harkins One"}),
        formats=frozenset({"IMAX"}),
    )

    assert filter_screenings(screenings, filters) == [screenings[1]]


def test_actual_start_filter_excludes_unknown_actual_start():
    screenings = [
        screening(actual=None, end=None),
        screening(actual="2026-09-04T18:30:00", end="2026-09-04T20:30:00"),
        screening(actual="2026-09-04T20:15:00", end="2026-09-04T22:15:00"),
    ]

    visible = filter_screenings(
        screenings,
        ScreeningFilters(start_after="18:00", start_before="20:00"),
    )

    assert visible == [screenings[1]]


def test_end_filter_excludes_unknown_end():
    screenings = [
        screening(end="2026-09-04T20:00:00"),
        screening(end="2026-09-04T22:15:00"),
        screening(end=None),
    ]

    visible = filter_screenings(screenings, ScreeningFilters(end_by="21:00"))

    assert visible == [screenings[0]]


def test_end_by_filter_excludes_next_day_end_after_midnight():
    before_boundary = screening(
        advertised="2026-09-04T16:00:00",
        actual="2026-09-04T16:25:00",
        end="2026-09-04T18:30:00",
    )
    after_midnight = screening(
        advertised="2026-09-04T21:30:00",
        actual="2026-09-04T21:55:00",
        end="2026-09-05T00:30:00",
    )

    visible = filter_screenings(
        [before_boundary, after_midnight],
        ScreeningFilters(end_by="19:00"),
    )

    assert visible == [before_boundary]


def test_start_filters_respect_next_day_actual_start():
    after_midnight = screening(
        advertised="2026-09-04T23:55:00",
        actual="2026-09-05T00:20:00",
        end="2026-09-05T02:00:00",
    )

    visible_after = filter_screenings(
        [after_midnight],
        ScreeningFilters(start_after="19:00"),
    )
    visible_before = filter_screenings(
        [after_midnight],
        ScreeningFilters(start_before="23:00"),
    )

    assert visible_after == [after_midnight]
    assert visible_before == []


def test_unknown_times_are_visible_without_time_filters():
    unknown = screening(actual=None, end=None)
    assert filter_screenings([unknown], ScreeningFilters()) == [unknown]


def test_facets_include_chains():
    screenings = [
        screening(
            movie="Zulu",
            theatre="Harkins Two",
            chain="Harkins Theatres",
            format_name="IMAX",
        ),
        screening(movie="Alpha", theatre="AMC One", chain="AMC", format_name="Standard"),
    ]

    assert facets(screenings) == {
        "movies": ["Alpha", "Zulu"],
        "theatres": ["AMC One", "Harkins Two"],
        "formats": ["IMAX", "Standard"],
        "chains": ["AMC", "Harkins Theatres"],
    }


class FakeLocator:
    def __init__(self, point=GeoPoint(0, 0)):
        self.point = point
        self.calls = []

    def lookup_zip(self, zip_code):
        self.calls.append(zip_code)
        return self.point


class FakeShowtimeClient:
    def __init__(self):
        self.calls = 0

    def fetch_showtimes(self, zip_code, show_date, *, page_limit=50):
        self.calls += 1
        assert zip_code == "85004"
        assert page_limit == 50
        return [
            raw_showtime("amc-1", "AMC One"),
            raw_showtime(
                "harkins-1",
                "Harkins One",
                movie="Movie B",
                chain="Harkins Theatres",
                hour=19,
            ),
        ]


def test_service_caches_location_data_and_applies_previews_per_chain():
    client = FakeShowtimeClient()
    locator = FakeLocator()
    service = ScreeningService(client, Settings(), locator=locator)
    show_date = date(2026, 9, 4)

    unknown = service.get_screenings(show_date)
    configured = service.get_screenings(show_date, {"AMC": 25})

    assert client.calls == 1
    assert locator.calls == ["85004"]
    assert all(item.actual_start is None for item in unknown)
    amc = next(item for item in configured if item.chain == "AMC")
    harkins = next(item for item in configured if item.chain == "Harkins Theatres")
    assert amc.actual_start == datetime(2026, 9, 4, 18, 25)
    assert amc.estimated_end == datetime(2026, 9, 4, 20, 5)
    assert amc.distance_miles == 0
    assert harkins.actual_start is None
    assert harkins.estimated_end is None


class RadiusShowtimeClient:
    def __init__(self):
        self.calls = []

    def fetch_showtimes(self, zip_code, show_date, *, page_limit=50):
        self.calls.append(zip_code)
        if zip_code == "85004":
            return [
                raw_showtime(
                    "edge-1",
                    "AMC Edge Seed",
                    zip_code="85032",
                    longitude=0.2,
                )
            ]
        if zip_code == "85032":
            return [
                raw_showtime(
                    "deer-1",
                    "AMC Deer Valley 17",
                    zip_code="85085",
                    longitude=0.3,
                ),
                raw_showtime(
                    "far-1",
                    "AMC Too Far",
                    zip_code="85399",
                    longitude=0.5,
                ),
            ]
        if zip_code == "85085":
            return [
                raw_showtime(
                    "deer-1",
                    "AMC Deer Valley 17",
                    zip_code="85085",
                    longitude=0.3,
                )
            ]
        return []


def test_radius_discovery_probes_neighbor_markets_and_filters_by_distance():
    client = RadiusShowtimeClient()
    service = ScreeningService(client, Settings(), locator=FakeLocator())
    show_date = date(2026, 9, 4)

    screenings = service.get_screenings(
        show_date,
        zip_code="85004",
        radius_miles=25,
    )

    theatres = {item.theatre for item in screenings}
    assert "85004" in client.calls
    assert "85032" in client.calls
    assert "AMC Edge Seed" in theatres
    assert "AMC Deer Valley 17" in theatres
    assert "AMC Too Far" not in theatres
    deer = next(item for item in screenings if item.theatre == "AMC Deer Valley 17")
    assert deer.distance_miles == 20.7


def test_cache_key_includes_location_and_radius():
    class CountingClient:
        def __init__(self):
            self.calls = []

        def fetch_showtimes(self, zip_code, show_date, *, page_limit=50):
            self.calls.append(zip_code)
            return [raw_showtime(f"{zip_code}-1", f"AMC {zip_code}", zip_code=zip_code)]

    client = CountingClient()
    locator = FakeLocator()
    service = ScreeningService(client, Settings(), locator=locator)
    show_date = date(2026, 9, 4)

    service.get_screenings(show_date, zip_code="85004", radius_miles=25)
    service.get_screenings(show_date, zip_code="85004", radius_miles=25)
    service.get_screenings(show_date, zip_code="85004", radius_miles=10)

    assert client.calls == ["85004", "85004"]
