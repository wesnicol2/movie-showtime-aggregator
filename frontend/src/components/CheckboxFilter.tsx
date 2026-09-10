import { useState } from "react";

export interface CheckboxOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  options: readonly CheckboxOption[];
  selected: string[] | null;
  open: boolean;
  searchable?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (selected: string[] | null) => void;
}

export function CheckboxFilter({
  label,
  options,
  selected,
  open,
  searchable = false,
  onOpenChange,
  onChange,
}: Props) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  function isChecked(value: string): boolean {
    return selected === null || selected.includes(value);
  }

  function toggleValue(value: string, checked: boolean): void {
    const next = new Set(selected ?? options.map((option) => option.value));
    if (checked) next.add(value);
    else next.delete(value);
    onChange(next.size === options.length ? null : [...next]);
  }

  return (
    <div className="checkbox-filter">
      <span>{label}</span>
      <button
        type="button"
        className={`checkbox-filter-trigger ${selected === null ? "" : "active"}`}
        aria-label={`Filter by ${label.toLocaleLowerCase()}`}
        aria-expanded={open}
        disabled={options.length === 0}
        onClick={() => onOpenChange(!open)}
      >
        <span className="checkbox-filter-summary">{summarize(options, selected)}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div
          className="filter-menu checkbox-filter-menu"
          role="dialog"
          aria-label={`${label} filter`}
        >
          <div className="filter-menu-heading">
            <strong>{label}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label={`Close ${label.toLocaleLowerCase()} filter`}
              onClick={() => onOpenChange(false)}
            >
              ×
            </button>
          </div>
          <div className="value-heading">
            <span>Values</span>
            <span className="inline-actions">
              <button type="button" className="text-button" onClick={() => onChange(null)}>
                All
              </button>
              <button type="button" className="text-button" onClick={() => onChange([])}>
                None
              </button>
            </span>
          </div>
          {searchable ? (
            <input
              className="value-search"
              type="search"
              placeholder="Search values"
              aria-label={`Search ${label.toLocaleLowerCase()} values`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <div className="value-list">
            {visibleOptions.map((option) => (
              <label className="check-row" key={option.value}>
                <input
                  type="checkbox"
                  checked={isChecked(option.value)}
                  onChange={(event) => toggleValue(option.value, event.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function summarize(options: readonly CheckboxOption[], selected: string[] | null): string {
  if (selected === null) return "All";
  if (selected.length === 0) return "None";
  if (selected.length === 1) {
    const only = options.find((option) => option.value === selected[0]);
    if (only) return only.label;
  }
  return `${selected.length} of ${options.length}`;
}
