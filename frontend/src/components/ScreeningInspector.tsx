import { COLUMNS, formatCell } from "../screenings";
import type { Screening } from "../types";

interface Props {
  screening: Screening;
  onClose: () => void;
}

export function ScreeningInspector({ screening, onClose }: Props) {
  const evidence = [
    ["Tickets", screening.purchase_url],
    ["Letterboxd", screening.letterboxd_url],
    ["IMDb", screening.imdb_url],
    ["Rotten Tomatoes", screening.rotten_tomatoes_url],
    ["Metacritic", screening.metacritic_url],
    ["AMC detail", screening.amc_source_url],
    ["Route", screening.route_source_url],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <aside className="inspector" aria-label="Screening detail">
      <div className="inspector-heading">
        <div>
          <p className="eyebrow">INSPECTING</p>
          <h2>{screening.movie}</h2>
          <p>{screening.theatre}</p>
        </div>
        <button className="icon-button" type="button" aria-label="Close inspector" onClick={onClose}>
          ×
        </button>
      </div>

      <dl className="inspector-grid">
        {COLUMNS.filter((column) => column.key !== "movie" && column.key !== "theatre").map((column) => (
          <div key={column.key}>
            <dt>{column.label}</dt>
            <dd>{formatCell(screening, column)}</dd>
          </div>
        ))}
      </dl>

      {evidence.length > 0 ? (
        <div className="evidence-links">
          <h3>Evidence</h3>
          <div>
            {evidence.map(([label, url]) => (
              <a key={`${label}-${url}`} href={url} target="_blank" rel="noreferrer">
                {label} ↗
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
