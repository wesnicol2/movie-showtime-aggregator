from movie_showtime_aggregator.fandango import flatten_market_showtimes


def market_payload():
    def theater(
        name,
        chain,
        theater_id,
        title,
        runtime,
        ticketing_date,
        *,
        film_format="",
        zip_code="85004",
        latitude=33.45,
        longitude=-112.07,
    ):
        return {
            "id": theater_id,
            "name": name,
            "chainName": chain,
            "zip": zip_code,
            "geo": {"latitude": latitude, "longitude": longitude},
            "movies": [
                {
                    "title": title,
                    "runtime": runtime,
                    "variants": [
                        {
                            "filmFormatHeader": film_format or "Standard",
                            "amenityGroups": [
                                {
                                    "amenities": [],
                                    "isDolby": film_format == "Dolby Cinema",
                                    "showtimes": [
                                        {
                                            "id": f"{theater_id}-1",
                                            "ticketingDate": ticketing_date,
                                            "expired": False,
                                            "isSoldOut": False,
                                            "type": "available",
                                            "filmFormat": [],
                                            "ticketingJumpPageURL": "https://example.com/tickets",
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
        }

    return {
        "theaters": [
            theater(
                "AMC Arizona Center 24",
                "AMC",
                "AAECS",
                "Movie A",
                101,
                "2026-09-04+18:30",
                film_format="Dolby Cinema",
            ),
            theater(
                "Harkins Christown 14",
                "Harkins Theatres",
                "AAUOH",
                "Movie B",
                124,
                "2026-09-04+19:00",
                zip_code="85015",
                latitude=33.52,
                longitude=-112.10,
            ),
        ]
    }


def test_flatten_market_showtimes_preserves_theater_chain_location_runtime_and_format():
    showtimes = flatten_market_showtimes(market_payload())

    assert len(showtimes) == 2
    assert showtimes[0]["theatreName"] == "AMC Arizona Center 24"
    assert showtimes[0]["chainName"] == "AMC"
    assert showtimes[0]["theatreZip"] == "85004"
    assert showtimes[0]["theatreLatitude"] == 33.45
    assert showtimes[0]["theatreLongitude"] == -112.07
    assert showtimes[0]["runTime"] == 101
    assert showtimes[0]["premiumFormat"] == "Dolby Cinema"
    assert showtimes[0]["showDateTimeLocal"] == "2026-09-04T18:30"
    assert showtimes[1]["theatreName"] == "Harkins Christown 14"
    assert showtimes[1]["chainName"] == "Harkins Theatres"


def test_zero_runtime_is_preserved_for_unknown_end_handling():
    payload = market_payload()
    payload["theaters"][0]["movies"][0]["runtime"] = 0

    assert flatten_market_showtimes(payload)[0]["runTime"] == 0


def test_expired_and_sold_out_flags_are_normalized():
    payload = market_payload()
    movie = payload["theaters"][0]["movies"][0]
    group = movie["variants"][0]["amenityGroups"][0]
    showtime = group["showtimes"][0]
    showtime["expired"] = True
    showtime["type"] = "soldout"

    flattened = flatten_market_showtimes(payload)[0]
    assert flattened["isExpired"] is True
    assert flattened["isSoldOut"] is True
