export type ColumnKey =
  | "movie"
  | "imdb_rating"
  | "rotten_tomatoes_score"
  | "metacritic_score"
  | "theatre"
  | "distance_miles"
  | "seats_left_percent"
  | "ticket_price"
  | "chain"
  | "advertised_start"
  | "actual_start"
  | "leave_home"
  | "estimated_end"
  | "home_arrival"
  | "format";

export type ColumnType = "text" | "number" | "time";
export type NumberFormat = "rating" | "percent" | "score" | "miles" | "currency";

export interface ColumnDefinition {
  key: ColumnKey;
  label: string;
  type: ColumnType;
  format?: NumberFormat;
  calculated?: boolean;
}

export interface Screening {
  showtime_id: string;
  movie: string;
  theatre: string;
  chain: string;
  format: string;
  advertised_start: string;
  actual_start: string | null;
  estimated_end: string | null;
  runtime_minutes: number | null;
  distance_miles: number | null;
  purchase_url: string;
  movie_source_id: string;
  theatre_latitude: number | null;
  theatre_longitude: number | null;
  drive_to_minutes: number | null;
  drive_home_minutes: number | null;
  leave_home: string | null;
  home_arrival: string | null;
  poster_url: string;
  imdb_id: string;
  imdb_rating: number | null;
  metacritic_score: number | null;
  rotten_tomatoes_score: number | null;
  ticket_price: number | null;
  seats_left_percent: number | null;
  amc_a_list_eligible: boolean | null;
  amc_source_url: string;
  letterboxd_url: string;
  imdb_url: string;
  rotten_tomatoes_url: string;
  metacritic_url: string;
  route_source_url: string;
}

export interface PublicPreferences {
  amc_vendor_key_set: boolean;
  omdb_api_key_set: boolean;
  amc_a_list: boolean;
  home_configured?: boolean;
}

export interface ScreeningLocation {
  zip_code: string;
  radius_miles: number;
}

export interface ScreeningsResponse {
  date: string;
  market_zip: string;
  radius_miles: number;
  location: ScreeningLocation;
  preferences: PublicPreferences;
  preview_minutes_by_chain: Record<string, number>;
  enrichment_enabled: boolean;
  count: number;
  total_count: number;
  facets: {
    chains: string[];
    movies?: string[];
    theatres?: string[];
    formats?: string[];
  };
  screenings: Screening[];
}

export interface ProviderRateLimit {
  limit?: number | null;
  remaining?: number | null;
  reset_at?: string | null;
  percent_used?: number | null;
}

export interface ProviderUsage {
  requests_today?: number;
  cache_hits_today?: number;
  published_percent_used?: number | null;
  estimated_remaining_today?: number | null;
  app_counter_reset_at?: string | null;
  provider_rate_limit?: ProviderRateLimit | null;
}

export interface SharedSettings extends PublicPreferences {
  home_address: string;
  home_display_name: string;
  provider_usage?: {
    omdb?: ProviderUsage;
    amc?: ProviderUsage;
  };
}

export interface SharedSettingsChanges {
  home_address?: string;
  amc_a_list?: boolean;
  amc_vendor_key?: string;
  omdb_api_key?: string;
  clear_amc_vendor_key?: boolean;
  clear_omdb_api_key?: boolean;
}
