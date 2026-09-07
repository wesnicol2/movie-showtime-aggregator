import { useState } from "react";

import { COLUMNS, type Filters, formatCell, type SortState, sourceUrl } from "../screenings";
import { useAppStore } from "../store";
import type { ColumnKey, Screening } from "../types";
import { ColumnFilter } from "./ColumnFilter";
import "./screening-table.css";

interface Props {
  screenings: Screening[];
  allScreenings: Screening[];
  filters: Filters;
  sort: SortState;
}

export function ScreeningTable({ screenings, allScreenings, filters, sort }: Props) {
  const [openColumn, setOpenColumn] = useState<ColumnKey | null>(null);
  const toggleSort = useAppStore((state) => state.toggleSort);
  const updateFilter = useAppStore((state) => state.updateFilter);
  const inspectedShowtimeId = useAppStore((state) => state.inspectedShowtimeId);
  const setInspectedShowtimeId = useAppStore((state) => state.setInspectedShowtimeId);

  return (
    <div className="table-scroll" data-testid="screening-table-wrap">
      <table className="screening-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort.key === column.key
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <div className="column-heading">
                  <button
                    className="sort-button"
                    type="button"
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label}
                    {sort.key === column.key ? (
                      <span className="sort-mark" aria-hidden="true">
                        {sort.direction === "asc" ? "↑" : "↓"}
                      </span>
                    ) : null}
                  </button>
                  <ColumnFilter
                    column={column}
                    filter={filters[column.key]}
                    screenings={allScreenings}
                    open={openColumn === column.key}
                    onOpenChange={(open) => setOpenColumn(open ? column.key : null)}
                    onChange={(patch) => updateFilter(column.key, patch)}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {screenings.map((screening) => (
            <tr
              key={`${screening.showtime_id}-${screening.theatre}`}
              className={inspectedShowtimeId === screening.showtime_id ? "selected-row" : undefined}
              aria-selected={inspectedShowtimeId === screening.showtime_id}
              onClick={() => setInspectedShowtimeId(screening.showtime_id)}
            >
              {COLUMNS.map((column) => {
                const url = sourceUrl(screening, column.key);
                const text = formatCell(screening, column);
                const unknown = text === "Unknown";
                return (
                  <td
                    key={column.key}
                    className={`${column.calculated ? "calculated" : ""} ${column.key === "movie" ? "movie-cell" : ""}`}
                  >
                    {url && !unknown ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {text}
                      </a>
                    ) : (
                      <span className={unknown ? "unknown" : undefined}>{text}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
