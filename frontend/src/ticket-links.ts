import type { Screening } from "./types";

type TicketSource = Pick<Screening, "chain" | "theatre" | "purchase_url" | "amc_source_url">;

export interface TicketDestination {
  url: string;
  officialAmc: boolean;
}

function officialAmcUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" &&
      (url.hostname === "amctheatres.com" || url.hostname.endsWith(".amctheatres.com"))
    );
  } catch {
    return false;
  }
}

/** Prefer a matched AMC performance, never an invented app URI or performance ID. */
export function ticketDestination(screening: TicketSource): TicketDestination | null {
  const isAmc = /\bamc\b/i.test(screening.chain) || /\bamc\b/i.test(screening.theatre);
  const amc = screening.amc_source_url?.trim() ?? "";
  if (isAmc && officialAmcUrl(amc)) return { url: amc, officialAmc: true };

  const fallback = screening.purchase_url?.trim() ?? "";
  if (!/^https?:\/\//i.test(fallback)) return null;
  return { url: fallback, officialAmc: false };
}
