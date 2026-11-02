import type { CSSProperties } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  type ColumnFilter as ColumnFilterState,
  type FilterOperator,
  formatMenuValue,
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

const MENU_WIDTH = 310;
const MENU_MARGIN = 8;
const MENU_GAP = 4;

function filterMenuPosition(trigger: HTMLButtonElement, menu: HTMLDivElement): CSSProperties {
  const bounds = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  const width = Math.max(0, Math.min(MENU_WIDTH, viewportWidth - 2 * MENU_MARGIN));
  const left = Math.max(
    viewportLeft + MENU_MARGIN,
    Math.min(bounds.right - width, viewportRight - width - MENU_MARGIN),
  );
  const below = Math.max(0, viewportBottom - bounds.bottom - MENU_GAP - MENU_MARGIN);
  const above = Math.max(0, bounds.top - viewportTop - MENU_GAP - MENU_MARGIN);
  const placeBelow = below >= Math.min(menu.scrollHeight, 440) || below >= above;
  const availableHeight = placeBelow ? below : above;
  const height = Math.min(menu.scrollHeight, availableHeight);

  return {
    left,
    top: placeBelow ? bounds.bottom + MENU_GAP : bounds.top - MENU_GAP - height,
    width,
    maxHeight: availableHeight,
  };
}

export function ColumnFilter({ column, filter, screenings, open, onOpenChange, onChange }: Props) {
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (triggerRef.current && menuRef.current) {
        setMenuPosition(filterMenuPosition(triggerRef.current, menuRef.current));
      }
    };
    const onScroll = (event: Event) => {
      // Scrolling the checkbox list should not needlessly reposition its own menu.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      reposition();
    };

    reposition();
    const observer = new ResizeObserver(reposition);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open]);
  const values = useMemo(() => uniqueValues(screenings, column), [column, screenings]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleValues = values.filter((value) =>
    formatMenuValue(value, column).toLocaleLowerCase().includes(normalizedQuery),
  );
  const rules =
    column.type === "text" ? TEXT_RULES : column.type === "number" ? NUMBER_RULES : TIME_RULES;
  const needsOperand =
    filter.operator !== "" && !["is_unknown", "is_not_unknown"].includes(filter.operator);

  function toggleValue(value: string, checked: boolean): void {
    const selected = new Set(filter.selected ?? values);
    if (checked) selected.add(value);
    else selected.delete(value);
    onChange({ selected: selected.size === values.length ? null : [...selected] });
  }

  return (
    <div className="column-filter">
      <button
        ref={triggerRef}
        className={`filter-trigger ${isFilterActive(filter) ? "active" : ""}`}
        type="button"
        aria-label={`Filter ${column.label}`}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="filter-menu"
          role="dialog"
          aria-label={`${column.label} filter`}
          style={menuPosition}
        >
          <div className="filter-menu-heading">
            <strong>{column.label}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Close filter"
              onClick={() => onOpenChange(false)}
            >
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
                type={
                  column.type === "number" ? "number" : column.type === "time" ? "time" : "text"
                }
                value={filter.operand}
                onChange={(event) => onChange({ operand: event.target.value })}
              />
            </label>
          ) : null}

          <div className="value-heading">
            <span>Values</span>
            <span className="inline-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => onChange({ selected: null })}
              >
                All
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => onChange({ selected: [] })}
              >
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
