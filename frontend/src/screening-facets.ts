import type { CheckboxOption } from "./components/CheckboxFilter";
import type { Screening } from "./types";

/** `null` means every value is included, so the filter is inactive. */
export type CheckboxSelection = string[] | null;

/** Exact-value screening dimensions shared by the Movies and Movie Day pages. */
export interface ScreeningFacets {
  theaters: CheckboxSelection;
  chains: CheckboxSelection;
  formats: CheckboxSelection;
  listedWindows: CheckboxSelection;
}

export const EMPTY_SCREENING_FACETS: ScreeningFacets = {
  theaters: null,
  chains: null,
  formats: null,
  listedWindows: null,
};

/** Listed-start buckets. Listed start is a provider fact, so it is never unknown. */
const LISTED_WINDOWS = [
  { value: "matinee", label: "Matinee · before 12pm", firstHour: 0, lastHour: 11 },
  { value: "afternoon", label: "Afternoon · 12–5pm", firstHour: 12, lastHour: 16 },
  { value: "evening", label: "Evening · 5–9pm", firstHour: 17, lastHour: 20 },
  { value: "late", label: "Late night · 9pm and later", firstHour: 21, lastHour: 23 },
] as const;

export function textOptions(
  screenings: readonly Screening[],
  key: "theatre" | "chain" | "format",
): CheckboxOption[] {
  return [...new Set(screenings.map((screening) => screening[key]))]
    .filter((value) => value !== "")
    .sort(compareText)
    .map((value) => ({ value, label: value }));
}

export function listedWindowOptions(screenings: readonly Screening[]): CheckboxOption[] {
  const present = new Set(screenings.map(listedWindow));
  return LISTED_WINDOWS.filter((window) => present.has(window.value)).map((window) => ({
    value: window.value,
    label: window.label,
  }));
}

export function listedWindow(screening: Screening): string | null {
  const hour = Number(screening.advertised_start.slice(11, 13));
  if (!Number.isFinite(hour)) return null;
  const match = LISTED_WINDOWS.find(
    (window) => hour >= window.firstHour && hour <= window.lastHour,
  );
  return match ? match.value : null;
}

export function activeFacetCount(facets: ScreeningFacets): number {
  return [facets.theaters, facets.chains, facets.formats, facets.listedWindows].filter(
    (selection) => selection !== null,
  ).length;
}

export function hasActiveFacet(facets: ScreeningFacets): boolean {
  return activeFacetCount(facets) > 0;
}

export function matchesFacets(screening: Screening, facets: ScreeningFacets): boolean {
  if (facets.theaters !== null && !facets.theaters.includes(screening.theatre)) return false;
  if (facets.chains !== null && !facets.chains.includes(screening.chain)) return false;
  if (facets.formats !== null && !facets.formats.includes(screening.format)) return false;
  if (facets.listedWindows !== null) {
    const window = listedWindow(screening);
    if (window === null || !facets.listedWindows.includes(window)) return false;
  }
  return true;
}

export function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}
