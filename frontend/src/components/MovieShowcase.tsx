import { formatListingDateTime, latestListedForMovie } from "../last-listed";
import type { Filters } from "../screenings";
import { formatListedTime, formatReleaseDate, type ShowcaseMovie } from "../showcase";
import { ticketDestination } from "../ticket-links";
import type { MovieAvailabilityResponse, Screening } from "../types";
import { TicketLink } from "./TicketLink";
import "./movie-showcase.css";

interface Props {
  movies: ShowcaseMovie[];
  allMovies: ShowcaseMovie[];
  allScreenings: Screening[];
  filters: Filters;
  futureAvailability: MovieAvailabilityResponse | null;
  futureError: boolean;
  selectedMovies: string[];
  watchedMovies: string[];
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const left = minutes % 60;
  return hours ? String(hours) + "h" + (left ? " " + left + "m" : "") : String(left) + "m";
}

function rating(name: string, score: number | null, url: string, suffix = "") {
  if (score === null) return null;
  const value = name + " " + score + suffix;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {value} ↗
    </a>
  ) : (
    <span>{value}</span>
  );
}

export function MovieShowcase({
  movies,
  allMovies,
  allScreenings,
  filters,
  futureAvailability,
  futureError,
  selectedMovies,
  watchedMovies,
}: Props) {
  return (
    <div className="showcase-list" data-testid="movie-showcase">
      {movies.map((movie) => {
        const info = movie.representative;
        const released = formatReleaseDate(info.initial_release_date);
        const latest = latestListedForMovie(
          movie,
          allMovies,
          allScreenings,
          futureAvailability?.future_screenings ?? [],
          filters,
        );
        const other = latest.laterOutsideFilters;
        const otherVenue =
          other && latest.matching &&
          (other.chain !== latest.matching.chain || other.theatre !== latest.matching.theatre);
        return (
          <article className="showcase-card" key={movie.key} data-testid="showcase-movie">
            <div className="showcase-poster">
              {info.poster_url ? (
                <img src={info.poster_url} alt={movie.title + " poster"} loading="lazy" />
              ) : (
                <span className="showcase-poster-missing">Poster unavailable</span>
              )}
            </div>
            <div className="showcase-body">
              <div className="showcase-title-row">
                <h2>{movie.title}</h2>
                {watchedMovies.includes(movie.title) ? (
                  <span className="showcase-status">Already seen</span>
                ) : selectedMovies.includes(movie.title) ? (
                  <span className="showcase-status">Watchlist</span>
                ) : null}
              </div>
              <div className="showcase-subtitle">
                {released ? <span>Released {released}</span> : null}
                {info.runtime_minutes !== null ? (
                  <span>{duration(info.runtime_minutes)}</span>
                ) : null}
                {movie.nearestMiles !== null ? (
                  <span>Nearest {movie.nearestMiles.toFixed(1)} mi</span>
                ) : null}
              </div>
              <div className="showcase-ratings">
                {rating("IMDb", info.imdb_rating, info.imdb_url)}
                {rating("RT", info.rotten_tomatoes_score, info.rotten_tomatoes_url, "%")}
                {rating("MC", info.metacritic_score, info.metacritic_url)}
                {info.letterboxd_url ? (
                  <a href={info.letterboxd_url} target="_blank" rel="noreferrer">
                    Letterboxd ↗
                  </a>
                ) : null}
              </div>
              <div className="showcase-last-listed" data-testid="last-listed">
                <div>
                  <strong>Latest listed with your filters</strong>
                  <span>
                    {latest.matching
                      ? `${formatListingDateTime(latest.matching.advertised_start)} · ${latest.matching.theatre} (${latest.matching.chain})`
                      : "No matching listings found"}
                  </span>
                </div>
                {other ? (
                  <p className="showcase-later">
                    {otherVenue ? "Later at another theater/chain" : "Later outside filters"}:{" "}
                    {formatListingDateTime(other.advertised_start)} · {other.theatre} ({other.chain})
                  </p>
                ) : null}
                {latest.laterUnverified ? (
                  <p className="showcase-later">
                    Later listing (filter match unknown):{" "}
                    {formatListingDateTime(latest.laterUnverified.advertised_start)} ·{" "}
                    {latest.laterUnverified.theatre} ({latest.laterUnverified.chain})
                  </p>
                ) : null}
                {latest.futureFiltersUnverified && futureAvailability ? (
                  <p className="showcase-listing-note">
                    Future matching cannot be verified for rating, ticket, or home-time filters.
                  </p>
                ) : null}
                {futureError ? (
                  <p className="showcase-listing-note">Later schedules could not be checked.</p>
                ) : !futureAvailability ? (
                  <p className="showcase-listing-note">Checking later listings…</p>
                ) : null}
              </div>
              <div className="showcase-chain-section">
                <h3>Playing at</h3>
                <div className="showcase-chain-list">
                  {movie.chains.map((chain) => (
                    <span className="showcase-chain" key={chain.name}>
                      {chain.name}{" "}
                      <strong>
                        {chain.theaters} {chain.theaters === 1 ? "theater" : "theaters"}
                      </strong>
                    </span>
                  ))}
                </div>
              </div>
              <p className="showcase-facts">
                <strong>
                  {movie.theaters.length} {movie.theaters.length === 1 ? "theater" : "theaters"}
                </strong>
                <span aria-hidden="true">·</span>
                <span>
                  {movie.screenings.length}{" "}
                  {movie.screenings.length === 1 ? "showtime" : "showtimes"}
                </span>
                {movie.formats.length > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{movie.formats.join(" / ")}</span>
                  </>
                ) : null}
                {movie.lowestPrice !== null ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{"Tickets from $" + movie.lowestPrice.toFixed(2)}</span>
                  </>
                ) : null}
              </p>
              <details className="showcase-details">
                <summary>View theaters and showtimes</summary>
                <div className="showcase-theaters">
                  {movie.theaters.map((theater) => (
                    <div className="showcase-theater" key={theater.key}>
                      <div className="showcase-theater-heading">
                        <strong>{theater.theatre}</strong>
                        <span>
                          {theater.chain}
                          {theater.distance_miles !== null
                            ? " · " + theater.distance_miles.toFixed(1) + " mi"
                            : ""}
                        </span>
                      </div>
                      <div className="showcase-times">
                        {theater.screenings.map((screening) => {
                          const label =
                            formatListedTime(screening.advertised_start) +
                            (screening.format ? " · " + screening.format : "") +
                            (screening.ticket_price !== null
                              ? " · $" + screening.ticket_price.toFixed(2)
                              : "");
                          const key = screening.showtime_id + "|" + screening.advertised_start;
                          return ticketDestination(screening) ? (
                            <TicketLink key={key} screening={screening}>
                              {label} ↗
                            </TicketLink>
                          ) : (
                            <span key={key}>{label}</span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </article>
        );
      })}
    </div>
  );
}
