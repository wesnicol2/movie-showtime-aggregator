import { useMemo, useState } from "react";

import {
  formatMenuValue,
  type ColumnFilter as ColumnFilterState,
  type FilterOperator,
  isFilterActive,
  uniqueValues,
} from "../screenings";
import type { ColumnDefinition, Screening } from "../types";

interface Props {
  column: ColumnDefinition;
  filter: ColumnFilterState;
  screenings: Screening[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<ColumnFilterState>) => void;
}

const TEXT_RULES: readonly [FilterOperator, string][] = [
  ["", "No rule"],
  ["contains", "Contains"],
  ["not_contains", "Does not contain"],
  ["equals", "Equals"],
  ["not_equals", "Does not equal"],
  ["begins", "Begins with"],
  ["ends", "Ends with"],
  ["is_unknown", "Is unknown"],
  ["is_not_unknown", "Is known"],
];

const NUMBER_RULES: readonly [FilterOperator, string][] = [
  ["", "No rule"],
  ["lt", "Less than"],
  ["lte", "At most"],
  ["gt", "Greater than"],
  ["gte", "At least"],
  ["equals", "Equals"],
  ["not_equals", "Does not equal"],
  ["is_unknown", "Is unknown"],
  ["is_not_unknown", "Is known"],
];

const TIME_RULES: readonly [FilterOperator, string][] = [
  ["", "No rule"],
  ["before", "At or before"],
  ["after", "At or after"],
  ["equals", "At"],
  ["not_equals", "Not at"],
  ["is_unknown", "Is unknown"],
  ["is_not_unknown", "Is known"],
];

export function ColumnFilter({ column, filter, screenings, open, onOpenChange, onChange }: Props) {
  const [query, setQuery] = useState("");
  const values = useMemo(() => uniqueValues(screenings, column), [column, screenings]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleValues = values.filter((value) =>
    formatMenuValue(value, column).toLocaleLowerCase().includes(normalizedQuery),
  );
  const rules = column.type === "text" ? TEXT_RULES : column.type === "number" ? NUMBER_RULES : TIME_RULES;
  const needsOperand = filter.operator !== "" && !["is_unknown", "is_not_unknown"].includes(filter.operator);

  function toggleValue(value: string, checked: boolean): void {
    const selected = new Set(filter.selected ?? values);
    if (checked) selected.add(value);
    else selected.delete(value);
    onChange({ selected: selected.size === values.length ? null : [...selected] });
  }

  return (
    <div className="column-filter">
      <button
        className={`filter-trigger ${isFilterActive(filter) ? "active" : ""}`}
        type="button"
        aria-label={`Filter ${column.label}`}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="filter-menu" role="dialog" aria-label={`${column.label} filter`}>
          <div className="filter-menu-heading">
            <strong>{column.label}</strong>
            <button type="button" className="icon-button" aria-label="Close filter" onClick={() => onOpenChange(false)}>
              ×
            </button>
          </div>

          <label className="field compact-field">
            <span>Rule</span>
            <select
              value={filter.operator}
              onChange={(event) => onChange({ operator: event.target.value as FilterOperator })}
            >
              {rules.map(([value, label]) => (
                <option key={value || "none"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {needsOperand ? (
            <label className="field compact-field">
              <span>Value</span>
              <input
                type={column.type === "number" ? "number" : column.type === "time" ? "time" : "text"}
                value={filter.operand}
                onChange={(event) => onChange({ operand: event.target.value })}
              />
            </label>
          ) : null}

          <div className="value-heading">
            <span>Values</span>
            <span className="inline-actions">
              <button type="button" className="text-button" onClick={() => onChange({ selected: null })}>
                All
              </button>
              <button type="button" className="text-button" onClick={() => onChange({ selected: [] })}>
                None
              </button>
            </span>
          </div>
          <input
            className="value-search"
            type="search"
            placeholder="Search values"
            aria-label={`Search ${column.label} values`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="value-list">
            {visibleValues.map((value) => (
              <label className="check-row" key={value}>
                <input
                  type="checkbox"
                  checked={filter.selected === null || filter.selected.includes(value)}
                  onChange={(event) => toggleValue(value, event.target.checked)}
                />
                <span>{formatMenuValue(value, column)}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
