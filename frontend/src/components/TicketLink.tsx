import type { ReactNode } from "react";
import { ticketDestination } from "../ticket-links";
import type { Screening } from "../types";

interface Props {
  screening: Screening;
  children?: ReactNode;
}

/** Ordinary HTTPS navigation allows Android to handle verified AMC App Links. */
export function TicketLink({ screening, children = "Tickets" }: Props) {
  const destination = ticketDestination(screening);
  if (!destination) return null;

  return (
    <a
      href={destination.url}
      target={destination.officialAmc ? undefined : "_blank"}
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
