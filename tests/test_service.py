from datetime import date, datetime

from movie_showtime_aggregator.config import Settings, Theatre
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
    format_name="Standard",
    advertised="2026-09-04T17:30:00",
    actual="2026-09-04T17:55:00",
    end="2026-09-04T20:00:00",
):
    return Screening(
        showtime_id=1,
        movie=movie,
        theatre=theatre,
        format=format_name,
        advertised_start=datetime.fromisoformat(advertised),
        actual_start=datetime.fromisoformat(actual),
        estimated_end=datetime.fromisoformat(end),
        runtime_minutes=125,
        purchase_url="",
    )


def test_filter_by_movie_theatre_and_format():
    screenings = [
        screening(),
        screening(movie="Movie B", theatre="AMC Two", format_name="IMAX"),
    ]
    filters = ScreeningFilters(
        movies=frozenset({"Movie B"}),
        theatres=frozenset({"AMC Two"}),
        formats=frozenset({"IMAX"}),
    )

    assert filter_screenings(screenings, filters) == [screenings[1]]


def test_filter_by_actual_start_window():
    screenings = [
        screening(actual="2026-09-04T17:55:00"),
        screening(actual="2026-09-04T18:30:00"),
        screening(actual="2026-09-04T20:15:00"),
    ]

    visible = filter_screenings(
        screenings,
        ScreeningFilters(start_after="18:00", start_before="20:00"),
    )

    assert visible == [screenings[1]]


def test_filter_by_estimated_end_time():
    screenings = [
        screening(end="2026-09-04T20:00:00"),
        screening(end="2026-09-04T22:15:00"),
    ]

    visible = filter_screenings(screenings, ScreeningFilters(end_by="21:00"))

    assert visible == [screenings[0]]


def test_facets_are_unique_and_sorted():
    screenings = [
        screening(movie="Zulu", theatre="AMC Two", format_name="IMAX"),
        screening(movie="Alpha", theatre="AMC One", format_name="Standard"),
        screening(movie="Alpha", theatre="AMC One", format_name="Standard"),
    ]

    assert facets(screenings) == {
        "movies": ["Alpha", "Zulu"],
        "theatres": ["AMC One", "AMC Two"],
        "formats": ["IMAX", "Standard"],
    }


class FakeAMCClient:
    def __init__(self):
        self.calls = 0

    def fetch_showtimes(self, theatre_id, show_date):
        self.calls += 1
        return [
            {
                "id": theatre_id,
                "movieName": "Movie A",
                "showDateTimeLocal": f"{show_date.isoformat()}T18:00:00",
                "runTime": 100,
                "premiumFormat": "",
                "isCanceled": False,
                "isSoldOut": False,
            }
        ]


def test_service_caches_complete_date_before_filtering():
    client = FakeAMCClient()
    settings = Settings(
        vendor_key="test",
        theatres=(Theatre("AMC One", 1), Theatre("AMC Two", 2)),
        cache_ttl_seconds=300,
    )
    service = ScreeningService(client, settings)
    show_date = date(2026, 9, 4)

    first = service.get_screenings(show_date)
    second = service.get_screenings(show_date)

    assert len(first) == 2
    assert second == first
    assert client.calls == 2
