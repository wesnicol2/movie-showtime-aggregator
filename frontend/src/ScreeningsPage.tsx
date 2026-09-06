import { useMemo, useState } from "react";

import { ScreeningInspector } from "./components/ScreeningInspector";
import { ScreeningTable } from "./components/ScreeningTable";
import { filterAndSort, isFilterActive } from "./screenings";
import {
  createSavedView,
  readSavedViews,
  type SavedView,
  useAppStore,
  writeSavedViews,
} from "./store";
import { useScreenings } from "./useScreenings";

export function ScreeningsPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const filters = useAppStore((state) => state.filters);
  const sort = useAppStore((state) => state.sort);
  const clearAllFilters = useAppStore((state) => state.clearAllFilters);
  const inspectedShowtimeId = useAppStore((state) => state.inspectedShowtimeId);
  const setInspectedShowtimeId = useAppStore((state) => state.setInspectedShowtimeId);
  const applySavedView = useAppStore((state) => state.applySavedView);
  const [savedViews, setSavedViews] = useState(readSavedViews);
  const [selectedView, setSelectedView] = useState("");

  const screenings = response?.screenings ?? [];
  const visible = useMemo(
    () => filterAndSort(screenings, filters, sort),
    [filters, screenings, sort],
  );
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;
  const inspected =
    screenings.find((screening) => screening.showtime_id === inspectedShowtimeId) ?? null;

  function saveView(): void {
    const rawName = window.prompt("Name this filter view:");
    if (rawName === null) return;
    const name = rawName.trim();
    if (!name) return;
    if (savedViews[name] && !window.confirm(`Replace saved view “${name}”?`)) return;
    const view: SavedView = createSavedView(sort, filters);
    const next = { ...savedViews, [name]: view };
    writeSavedViews(next);
    setSavedViews(next);
    setSelectedView(name);
  }

  function loadView(name: string): void {
    setSelectedView(name);
    if (!name) return;
    const view = savedViews[name];
    if (view) applySavedView(view);
  }

  function deleteView(): void {
    if (!selectedView || !window.confirm(`Delete saved view “${selectedView}”?`)) return;
    const next = { ...savedViews };
    delete next[selectedView];
    writeSavedViews(next);
    setSavedViews(next);
    setSelectedView("");
  }

  return (
    <section className="workspace" aria-labelledby="screenings-heading">
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">DECISION WORKSPACE</p>
          <h1 id="screenings-heading">Screenings</h1>
        </div>
        <div className="workspace-actions">
          <label className="select-label">
            <span className="sr-only">Saved view</span>
            <select value={selectedView} onChange={(event) => loadView(event.target.value)}>
              <option value="">Saved views</option>
              {Object.keys(savedViews)
                .sort((left, right) => left.localeCompare(right))
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" onClick={saveView}>
            Save view
          </button>
          <button type="button" disabled={!selectedView} onClick={deleteView}>
            Delete
          </button>
          {activeFilterCount > 0 ? (
            <button type="button" onClick={clearAllFilters}>
              Clear {activeFilterCount}
            </button>
          ) : null}
        </div>
      </div>

      {status === "loading" ? (
        <div className="status-strip">Loading today’s screenings…</div>
      ) : null}
      {error ? (
        <div className="status-strip error" role="alert">
          {error}
        </div>
      ) : null}
      {response ? (
        <>
          <div className="result-strip" aria-live="polite">
            <strong>{visible.length}</strong> of {screenings.length} screenings
            <span>·</span>
            <span>
              {response.location.radius_miles} mi from {response.location.zip_code}
            </span>
            {activeFilterCount > 0 ? (
              <>
                <span>·</span>
                <span>{activeFilterCount} active filters</span>
              </>
            ) : null}
          </div>
          <div className={`screening-layout ${inspected ? "with-inspector" : ""}`}>
            <div className="results-pane">
              <ScreeningTable
                screenings={visible}
                allScreenings={screenings}
                filters={filters}
                sort={sort}
              />
              {visible.length === 0 ? (
                <p className="empty-state">No screenings match the active column filters.</p>
              ) : null}
            </div>
            {inspected ? (
              <ScreeningInspector
                screening={inspected}
                onClose={() => setInspectedShowtimeId(null)}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
