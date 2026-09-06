import type { ColumnDefinition, ColumnKey, Screening } from "./types";

export type FilterOperator =
  | ""
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "begins"
  | "ends"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "before"
  | "after"
  | "is_unknown"
  | "is_not_unknown";

export interface ColumnFilter {
  selected: string[] | null;
  operator: FilterOperator;
  operand: string;
}

export interface SortState {
  key: ColumnKey;
  direction: "asc" | "desc";
}

export type Filters = Record<ColumnKey, ColumnFilter>;

const UNKNOWN = "__unknown__";

export const COLUMNS: readonly ColumnDefinition[] = [
  { key: "movie", label: "Movie", type: "text" },
  { key: "imdb_rating", label: "IMDb", type: "number", format: "rating" },
  { key: "rotten_tomatoes_score", label: "RT", type: "number", format: "percent" },
  { key: "metacritic_score", label: "MC", type: "number", format: "score" },
  { key: "theatre", label: "Theater", type: "text" },
  { key: "distance_miles", label: "Miles", type: "number", format: "miles" },
  { key: "seats_left_percent", label: "Seats", type: "number", format: "percent" },
  { key: "ticket_price", label: "Price", type: "number", format: "currency" },
  { key: "chain", label: "Chain", type: "text" },
  { key: "advertised_start", label: "Listed", type: "time" },
  { key: "actual_start", label: "Actual", type: "time", calculated: true },
  { key: "leave_home", label: "Leave", type: "time", calculated: true },
  { key: "estimated_end", label: "Ends", type: "time", calculated: true },
  { key: "home_arrival", label: "Home", type: "time", calculated: true },
  { key: "format", label: "Format", type: "text" },
] as const;

export function createEmptyFilters(): Filters {
  return Object.fromEntries(
    COLUMNS.map((column) => [column.key, { selected: null, operator: "", operand: "" }]),
  ) as Filters;
}

export function canonicalValue(value: Screening[ColumnKey]): string {
  if (value === null || value === undefined || value === "") {
    return UNKNOWN;
  }
  return String(value);
}

export function isUnknown(value: string): boolean {
  return value === UNKNOWN;
}

export function isFilterActive(filter: ColumnFilter): boolean {
  return filter.selected !== null || filter.operator !== "";
}

export function uniqueValues(screenings: Screening[], column: ColumnDefinition): string[] {
  const values = new Set(screenings.map((screening) => canonicalValue(screening[column.key])));
  return [...values].sort((left, right) => compareCanonical(left, right, column));
}

function compareCanonical(left: string, right: string, column: ColumnDefinition): number {
  if (left === UNKNOWN) return right === UNKNOWN ? 0 : 1;
  if (right === UNKNOWN) return -1;
  if (column.type === "time") return Date.parse(left) - Date.parse(right);
  if (column.type === "number") return Number(left) - Number(right);
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function timeBoundary(screening: Screening, operand: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(operand)) return null;
  const datePart = screening.advertised_start.slice(0, 10);
  const parsed = Date.parse(`${datePart}T${operand}:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesRule(
  screening: Screening,
  column: ColumnDefinition,
  filter: ColumnFilter,
  value: string,
): boolean {
  if (!filter.operator) return true;
  const unknown = value === UNKNOWN;
  if (filter.operator === "is_unknown") return unknown;
  if (filter.operator === "is_not_unknown") return !unknown;
  if (unknown) return false;

  const operand = filter.operand.trim();
  if (!operand) return true;

  if (column.type === "text") {
    const actual = value.toLocaleLowerCase();
    const expected = operand.toLocaleLowerCase();
    if (filter.operator === "contains") return actual.includes(expected);
    if (filter.operator === "not_contains") return !actual.includes(expected);
    if (filter.operator === "equals") return actual === expected;
    if (filter.operator === "not_equals") return actual !== expected;
    if (filter.operator === "begins") return actual.startsWith(expected);
    if (filter.operator === "ends") return actual.endsWith(expected);
    return true;
  }

  if (column.type === "number") {
    const actual = Number(value);
    const expected = Number(operand);
    if (!Number.isFinite(expected)) return true;
    if (filter.operator === "lt") return actual < expected;
    if (filter.operator === "lte") return actual <= expected;
    if (filter.operator === "gt") return actual > expected;
    if (filter.operator === "gte") return actual >= expected;
    if (filter.operator === "equals") return actual === expected;
    if (filter.operator === "not_equals") return actual !== expected;
    return true;
  }

  const actual = Date.parse(value);
  const boundary = timeBoundary(screening, operand);
  if (boundary === null) return true;
  if (filter.operator === "before") return actual <= boundary;
  if (filter.operator === "after") return actual >= boundary;
  if (filter.operator === "equals")
    return Math.floor(actual / 60000) === Math.floor(boundary / 60000);
  if (filter.operator === "not_equals")
    return Math.floor(actual / 60000) !== Math.floor(boundary / 60000);
  return true;
}

function matchesFilter(
  screening: Screening,
  column: ColumnDefinition,
  filter: ColumnFilter,
): boolean {
  const value = canonicalValue(screening[column.key]);
  if (filter.selected !== null && !filter.selected.includes(value)) return false;
  return matchesRule(screening, column, filter, value);
}

export function filterAndSort(
  screenings: Screening[],
  filters: Filters,
  sort: SortState,
): Screening[] {
  const sortColumn = COLUMNS.find((column) => column.key === sort.key) ?? COLUMNS[0];
  if (!sortColumn) return [...screenings];
  return screenings
    .filter((screening) =>
      COLUMNS.every((column) => matchesFilter(screening, column, filters[column.key])),
    )
    .sort((left, right) => {
      const comparison = compareCanonical(
        canonicalValue(left[sort.key]),
        canonicalValue(right[sort.key]),
        sortColumn,
      );
      return sort.direction === "asc" ? comparison : -comparison;
    });
}

function dayOffset(baseValue: string, value: string): number {
  const base = baseValue.slice(0, 10).split("-").map(Number);
  const current = value.slice(0, 10).split("-").map(Number);
  const [baseYear, baseMonth, baseDay] = base;
  const [year, month, day] = current;
  if (
    baseYear === undefined ||
    baseMonth === undefined ||
    baseDay === undefined ||
    year === undefined ||
    month === undefined ||
    day === undefined
  ) {
    return 0;
  }
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(baseYear, baseMonth - 1, baseDay)) / 86400000,
  );
}

function formatTime(value: string, advertisedStart: string): string {
  const formatted = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
  const offset = dayOffset(advertisedStart, value);
  return offset === 0 ? formatted : `${formatted} (${offset > 0 ? "+" : ""}${offset}d)`;
}

export function formatMenuValue(value: string, column: ColumnDefinition): string {
  if (value === UNKNOWN) return "Unknown";
  if (column.type === "time") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }
  if (column.type === "number") return formatNumber(Number(value), column.format);
  return value;
}

function formatNumber(value: number, format?: ColumnDefinition["format"]): string {
  if (!Number.isFinite(value)) return "Unknown";
  if (format === "miles") return `${value.toFixed(1)} mi`;
  if (format === "percent") return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  if (format === "currency") {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
  }
  if (format === "rating") return value.toFixed(1);
  if (format === "score") return String(Math.round(value));
  return value.toLocaleString();
}

export function formatCell(screening: Screening, column: ColumnDefinition): string {
  const value = screening[column.key];
  if (value === null || value === undefined || value === "") return "Unknown";
  if (column.type === "time") return formatTime(String(value), screening.advertised_start);
  if (column.type === "number") return formatNumber(Number(value), column.format);
  return String(value);
}

export function sourceUrl(screening: Screening, key: ColumnKey): string {
  if (key === "movie") return screening.letterboxd_url;
  if (key === "imdb_rating") return screening.imdb_url;
  if (key === "rotten_tomatoes_score") return screening.rotten_tomatoes_url;
  if (key === "metacritic_score") return screening.metacritic_url;
  if (key === "ticket_price" || key === "seats_left_percent") {
    return screening.amc_source_url || screening.purchase_url;
  }
  if (key === "leave_home" || key === "home_arrival") return screening.route_source_url;
  return screening.purchase_url;
}
