import { compareText } from "./screening-facets";
import type { Screening } from "./types";

export type ShowcaseSort =
  | "title"
  | "initial_release_date"
  | "imdb_rating"
  | "rotten_tomatoes_score"
  | "metacritic_score"
  | "theaters"
  | "showtimes"
  | "distance_miles";

export interface ShowcaseTheater {
  key: string;
  theatre: string;
  chain: string;
  distance_miles: number | null;
  screenings: Screening[];
}
export interface ShowcaseMovie {
  key: string;
  title: string;
  representative: Screening;
  screenings: Screening[];
  theaters: ShowcaseTheater[];
  chains: { name: string; theaters: number }[];
  formats: string[];
  nearestMiles: number | null;
  lowestPrice: number | null;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function metadataScore(s: Screening): number {
  return [
    s.poster_url,
    s.imdb_id,
    s.initial_release_date,
    s.imdb_rating,
    s.rotten_tomatoes_score,
    s.metacritic_score,
    s.runtime_minutes,
  ].filter((x) => x !== null && x !== undefined && x !== "").length;
}

interface Bucket {
  rows: Screening[];
  imdbIds: Set<string>;
  sourceIds: Set<string>;
}

function makeBuckets(screenings: readonly Screening[]): Bucket[] {
  const byTitle = new Map<string, Bucket[]>();
  const byImdb = new Map<string, Bucket>();
  const bySource = new Map<string, Bucket>();
  const buckets: Bucket[] = [];
  for (const screening of screenings) {
    const title = normalized(screening.movie);
    const imdbId = normalized(screening.imdb_id || "");
    const sourceId = normalized(screening.movie_source_id || "");
    const titleBuckets = byTitle.get(title) ?? [];
    let bucket = imdbId ? byImdb.get(imdbId) : undefined;
    if (!bucket && sourceId) {
      const candidate = bySource.get(sourceId);
      if (candidate && (!imdbId || candidate.imdbIds.size === 0 || candidate.imdbIds.has(imdbId)))
        bucket = candidate;
    }
    if (!bucket && imdbId) {
      bucket =
        titleBuckets.find((item) => item.imdbIds.has(imdbId)) ??
        titleBuckets.find((item) => item.imdbIds.size === 0);
    }
    if (!bucket && !imdbId) {
      bucket =
        titleBuckets.length === 1
          ? titleBuckets[0]
          : titleBuckets.find((item) => item.imdbIds.size === 0);
    }
    if (!bucket) {
      bucket = { rows: [], imdbIds: new Set(), sourceIds: new Set() };
      buckets.push(bucket);
    }
    if (!titleBuckets.includes(bucket)) {
      titleBuckets.push(bucket);
      byTitle.set(title, titleBuckets);
    }
    bucket.rows.push(screening);
    if (imdbId) {
      bucket.imdbIds.add(imdbId);
      byImdb.set(imdbId, bucket);
    }
    if (sourceId) {
      bucket.sourceIds.add(sourceId);
      bySource.set(sourceId, bucket);
    }
  }
  return buckets;
}

function compareNullable(
  a: number | string | null,
  b: number | string | null,
  direction = 1,
): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const cmp =
    typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
  return direction * cmp;
}

export function buildShowcase(screenings: readonly Screening[]): ShowcaseMovie[] {
  return makeBuckets(screenings).map((bucket, index) => {
    const rows = bucket.rows;
    const representative = rows.reduce((best, row) =>
      metadataScore(row) > metadataScore(best) ? row : best,
    );
    const byTheater = new Map<string, ShowcaseTheater>();
    const formats = new Set<string>();
    let nearestMiles: number | null = null;
    let lowestPrice: number | null = null;
    for (const row of rows) {
      const key = normalized(row.chain) + "|" + normalized(row.theatre);
      let theater = byTheater.get(key);
      if (!theater) {
        theater = {
          key,
          theatre: row.theatre,
          chain: row.chain,
          distance_miles: null,
          screenings: [],
        };
        byTheater.set(key, theater);
      }
      theater.screenings.push(row);
      if (row.distance_miles !== null) {
        if (theater.distance_miles === null || row.distance_miles < theater.distance_miles)
          theater.distance_miles = row.distance_miles;
        if (nearestMiles === null || row.distance_miles < nearestMiles)
          nearestMiles = row.distance_miles;
      }
      if (row.ticket_price !== null && (lowestPrice === null || row.ticket_price < lowestPrice))
        lowestPrice = row.ticket_price;
      if (row.format) formats.add(row.format);
    }
    const theaters = [...byTheater.values()].sort(
      (a, b) =>
        compareNullable(a.distance_miles, b.distance_miles) || compareText(a.theatre, b.theatre),
    );
    for (const theater of theaters)
      theater.screenings.sort((a, b) => a.advertised_start.localeCompare(b.advertised_start));
    const byChain = new Map<string, { name: string; theaters: number }>();
    for (const theater of theaters) {
      const key = normalized(theater.chain);
      const chain = byChain.get(key);
      if (chain) chain.theaters++;
      else byChain.set(key, { name: theater.chain, theaters: 1 });
    }
    return {
      key:
        normalized(representative.movie) + "|" + [...bucket.imdbIds].sort().join(",") + "|" + index,
      title: representative.movie,
      representative,
      screenings: rows,
      theaters,
      chains: [...byChain.values()].sort(
        (a, b) => b.theaters - a.theaters || compareText(a.name, b.name),
      ),
      formats: [...formats].sort(compareText),
      nearestMiles,
      lowestPrice,
    };
  });
}

export function sortShowcase(
  movies: readonly ShowcaseMovie[],
  sort: ShowcaseSort,
  direction: "asc" | "desc",
): ShowcaseMovie[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...movies].sort((a, b) => {
    if (sort === "title") return sign * compareText(a.title, b.title);
    let cmp: number;
    if (sort === "theaters") cmp = sign * (a.theaters.length - b.theaters.length);
    else if (sort === "showtimes") cmp = sign * (a.screenings.length - b.screenings.length);
    else if (sort === "distance_miles") cmp = compareNullable(a.nearestMiles, b.nearestMiles, sign);
    else cmp = compareNullable(a.representative[sort], b.representative[sort], sign);
    return cmp || compareText(a.title, b.title);
  });
}

export function formatListedTime(iso: string): string {
  const hour = Number(iso.slice(11, 13));
  const mins = iso.slice(14, 16);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !/^\d{2}$/.test(mins)) return iso;
  return String(hour % 12 || 12) + ":" + mins + (hour < 12 ? " AM" : " PM");
}

export function formatReleaseDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value + "T12:00:00Z");
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
