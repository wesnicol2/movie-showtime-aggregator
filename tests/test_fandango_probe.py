import json
import urllib.parse
import urllib.request
from datetime import date


def test_probe_fandango_movie_shape():
    show_date = date.today().isoformat()
    tms_id = "AAECS"
    params = urllib.parse.urlencode(
        {
            "chainCode": "AMC",
            "startDate": show_date,
            "isdesktop": "true",
            "partnerRestrictedTicketing": "",
        }
    )
    url = f"https://www.fandango.com/napi/theaterMovieShowtimes/{tms_id}?{params}"
    referer = f"https://www.fandango.com/amc-arizona-center-24-aaecs/theater-page?date={show_date}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read())

    movies = payload.get("viewModel", {}).get("movies", [])
    assert movies, payload
    summary = [
        {
            "id": movie.get("id"),
            "title": movie.get("title"),
            "runtime": movie.get("runtime"),
            "mopURI": movie.get("mopURI"),
        }
        for movie in movies
    ]
    raise AssertionError(json.dumps(summary, indent=2))
