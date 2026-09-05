const UNKNOWN = "__unknown__";
const SAVED_VIEWS_KEY = "movie-showtime-aggregator.saved-views.v1";

const columns = [
  { key: "movie", label: "Movie", type: "text" },
  { key: "theatre", label: "Theater", type: "text" },
  { key: "chain", label: "Chain", type: "text" },
  { key: "advertised_start", label: "Listed", type: "time" },
  { key: "actual_start", label: "Actual start", type: "time" },
  { key: "estimated_end", label: "Ends", type: "time" },
  { key: "format", label: "Format", type: "text" },
];

const state = {
  screenings: [],
  previewMinutes: new Map(),
  filters: Object.fromEntries(
    columns.map((column) => [
      column.key,
      { selected: null, operator: "", operand: "" },
    ]),
  ),
  sort: { key: "advertised_start", direction: "asc" },
  openColumn: null,
  marketZip: "",
};

function browserDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildParams() {
  const params = new URLSearchParams({ date: browserDate() });
  for (const [chain, minutes] of state.previewMinutes.entries()) {
    params.append("preview", `${chain}:${minutes}`);
  }
  return params;
}

async function loadScreenings() {
  const error = document.getElementById("error");
  error.hidden = true;

  try {
    const response = await fetch(`/api/screenings?${buildParams()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);

    state.screenings = payload.screenings || [];
    state.marketZip = payload.market_zip || "";
    renderAll();
  } catch (err) {
    state.screenings = [];
    renderRows();
    document.getElementById("result-count").textContent = "Unavailable";
    error.textContent = err.message;
    error.hidden = false;
  }
}

function renderAll() {
  renderHeaders();
  renderRows();
  if (state.openColumn) renderColumnMenu(state.openColumn);
}

function renderHeaders() {
  const head = document.getElementById("screenings-head");
  head.replaceChildren();

  for (const column of columns) {
    const th = document.createElement("th");
    th.dataset.column = column.key;
    th.setAttribute("aria-sort", ariaSort(column.key));

    const wrapper = document.createElement("div");
    wrapper.className = "column-header";

    const sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = "sort-control";
    sortButton.dataset.sortColumn = column.key;
    sortButton.title = `Sort by ${column.label}`;

    const label = document.createElement("span");
    label.textContent = column.label;

    const indicator = document.createElement("span");
    indicator.className = "sort-indicator";
    indicator.setAttribute("aria-hidden", "true");
    if (state.sort.key === column.key) {
      indicator.textContent = state.sort.direction === "asc" ? "▲" : "▼";
      th.classList.add("sorted");
    }

    sortButton.append(label, indicator);
    sortButton.addEventListener("click", () => toggleSort(column.key));

    const filterButton = document.createElement("button");
    filterButton.type = "button";
    filterButton.className = "filter-control";
    filterButton.dataset.filterColumn = column.key;
    filterButton.setAttribute("aria-label", `Filter ${column.label}`);
    filterButton.setAttribute("aria-expanded", String(state.openColumn === column.key));
    filterButton.textContent = "▾";
    filterButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.openColumn === column.key) closeColumnMenu();
      else openColumnMenu(column.key);
    });

    if (isFilterActive(column.key)) {
      th.classList.add("filtered");
      filterButton.title = `${column.label} has an active filter`;
    } else {
      filterButton.title = `Filter ${column.label}`;
    }

    wrapper.append(sortButton, filterButton);
    th.append(wrapper);
    head.append(th);
  }
}

function toggleSort(columnKey) {
  if (state.sort.key === columnKey) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort = { key: columnKey, direction: "asc" };
  }
  markViewDirty();
  closeColumnMenu();
  renderHeaders();
  renderRows();
}

function setSort(columnKey, direction) {
  state.sort = { key: columnKey, direction };
  markViewDirty();
  closeColumnMenu();
  renderHeaders();
  renderRows();
}

function ariaSort(columnKey) {
  if (state.sort.key !== columnKey) return "none";
  return state.sort.direction === "asc" ? "ascending" : "descending";
}

function renderRows() {
  const body = document.getElementById("screenings-body");
  const empty = document.getElementById("empty-state");
  const visible = sortRows(filterRows(state.screenings));

  body.replaceChildren();
  empty.hidden = visible.length !== 0;

  for (const screening of visible) {
    const row = document.createElement("tr");
    for (const column of columns) {
      row.append(renderCell(screening, column));
    }
    body.append(row);
  }

  const filterCount = columns.filter((column) => isFilterActive(column.key)).length;
  const filterText = filterCount ? ` · ${filterCount} filter${filterCount === 1 ? "" : "s"}` : "";
  const zipText = state.marketZip ? ` · ZIP ${state.marketZip}` : "";
  document.getElementById("result-count").textContent =
    `${visible.length} of ${state.screenings.length} screenings${zipText}${filterText}`;
}

function renderCell(screening, column) {
  const td = document.createElement("td");
  td.dataset.column = column.key;

  if (column.key === "movie" && screening.purchase_url) {
    const link = document.createElement("a");
    link.href = screening.purchase_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = screening.movie;
    td.append(link);
    return td;
  }

  if (column.type === "time") {
    const value = screening[column.key];
    td.textContent = value ? formatTableTime(value, screening.advertised_start) : "Unknown";
    if (!value) td.classList.add("unknown");
    if (column.key !== "advertised_start") td.classList.add("calculated-time");
    return td;
  }

  td.textContent = screening[column.key] || "Unknown";
  return td;
}

function filterRows(screenings) {
  return screenings.filter((screening) =>
    columns.every((column) => matchesColumnFilter(screening, column)),
  );
}

function matchesColumnFilter(screening, column) {
  const filter = state.filters[column.key];
  const canonical = canonicalValue(screening[column.key]);

  if (filter.selected !== null && !filter.selected.has(canonical)) return false;
  if (!filter.operator) return true;
  return matchesRule(screening, column, filter);
}

function matchesRule(screening, column, filter) {
  const value = screening[column.key];

  if (filter.operator === "is_unknown") return value == null || value === "";
  if (filter.operator === "is_not_unknown") return value != null && value !== "";
  if (!filter.operand) return true;
  if (value == null || value === "") return false;

  if (column.type === "text") {
    const actual = String(value).toLocaleLowerCase();
    const expected = filter.operand.toLocaleLowerCase();
    switch (filter.operator) {
      case "contains": return actual.includes(expected);
      case "not_contains": return !actual.includes(expected);
      case "equals": return actual === expected;
      case "not_equals": return actual !== expected;
      case "begins_with": return actual.startsWith(expected);
      case "ends_with": return actual.endsWith(expected);
      default: return true;
    }
  }

  const boundary = boundaryForScreening(screening, filter.operand);
  const actual = new Date(value).getTime();
  if (!Number.isFinite(boundary) || !Number.isFinite(actual)) return false;

  switch (filter.operator) {
    case "before": return actual < boundary;
    case "before_or_equal": return actual <= boundary;
    case "after": return actual > boundary;
    case "after_or_equal": return actual >= boundary;
    case "equals": return Math.floor(actual / 60000) === Math.floor(boundary / 60000);
    case "not_equals": return Math.floor(actual / 60000) !== Math.floor(boundary / 60000);
    default: return true;
  }
}

function boundaryForScreening(screening, timeValue) {
  const [hours, minutes] = timeValue.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return Number.NaN;

  const boundary = new Date(screening.advertised_start);
  boundary.setHours(hours, minutes, 0, 0);
  return boundary.getTime();
}

function sortRows(screenings) {
  const column = columns.find((item) => item.key === state.sort.key);
  if (!column) return [...screenings];

  const direction = state.sort.direction === "asc" ? 1 : -1;
  return [...screenings].sort((left, right) => {
    const leftValue = left[column.key];
    const rightValue = right[column.key];

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    let comparison;
    if (column.type === "time") {
      comparison = new Date(leftValue).getTime() - new Date(rightValue).getTime();
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    return comparison * direction;
  });
}

function openColumnMenu(columnKey) {
  state.openColumn = columnKey;
  renderHeaders();
  renderColumnMenu(columnKey);
}

function closeColumnMenu() {
  state.openColumn = null;
  const menu = document.getElementById("column-menu");
  menu.hidden = true;
  renderHeaders();
}

function renderColumnMenu(columnKey) {
  const column = columns.find((item) => item.key === columnKey);
  if (!column) return;

  const filter = state.filters[columnKey];
  const menu = document.getElementById("column-menu");
  menu.replaceChildren();
  menu.hidden = false;
  menu.onclick = (event) => event.stopPropagation();

  const heading = document.createElement("div");
  heading.className = "menu-heading";
  const title = document.createElement("strong");
  title.textContent = column.label;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "link-button";
  clear.textContent = "Clear filter";
  clear.disabled = !isFilterActive(columnKey);
  clear.addEventListener("click", () => {
    state.filters[columnKey] = { selected: null, operator: "", operand: "" };
    markViewDirty();
    renderRows();
    renderHeaders();
    renderColumnMenu(columnKey);
  });
  heading.append(title, clear);
  menu.append(heading);

  menu.append(renderSortSection(column));
  menu.append(renderRuleSection(column, filter));
  menu.append(renderValuesSection(column, filter));
  if (column.key === "chain") menu.append(renderPreviewSection());

  positionColumnMenu(columnKey);
}

function renderSortSection(column) {
  const section = document.createElement("div");
  section.className = "menu-section sort-section";

  const asc = document.createElement("button");
  asc.type = "button";
  asc.textContent = column.type === "time" ? "Sort earliest → latest" : "Sort A → Z";
  asc.addEventListener("click", () => setSort(column.key, "asc"));

  const desc = document.createElement("button");
  desc.type = "button";
  desc.textContent = column.type === "time" ? "Sort latest → earliest" : "Sort Z → A";
  desc.addEventListener("click", () => setSort(column.key, "desc"));

  section.append(asc, desc);
  return section;
}

function renderRuleSection(column, filter) {
  const section = document.createElement("div");
  section.className = "menu-section rule-section";

  const label = document.createElement("label");
  label.className = "menu-label";
  label.textContent = column.type === "time" ? "Time filter" : "Text filter";

  const controls = document.createElement("div");
  controls.className = "rule-controls";

  const select = document.createElement("select");
  for (const [value, text] of ruleOptions(column.type)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = filter.operator === value;
    select.append(option);
  }

  const operand = document.createElement("input");
  operand.type = column.type === "time" ? "time" : "search";
  operand.placeholder = column.type === "time" ? "Time" : "Value";
  operand.value = filter.operand;
  operand.hidden = ["", "is_unknown", "is_not_unknown"].includes(filter.operator);

  select.addEventListener("change", () => {
    filter.operator = select.value;
    operand.hidden = ["", "is_unknown", "is_not_unknown"].includes(filter.operator);
    markViewDirty();
    renderRows();
    renderHeaders();
  });

  operand.addEventListener("input", () => {
    filter.operand = operand.value;
    markViewDirty();
    renderRows();
    renderHeaders();
  });

  controls.append(select, operand);
  label.append(controls);
  section.append(label);
  return section;
}

function ruleOptions(type) {
  if (type === "time") {
    return [
      ["", "No rule"],
      ["before", "Before"],
      ["before_or_equal", "Before or equal to"],
      ["after", "After"],
      ["after_or_equal", "After or equal to"],
      ["equals", "Equals"],
      ["not_equals", "Does not equal"],
      ["is_unknown", "Is unknown"],
      ["is_not_unknown", "Is not unknown"],
    ];
  }

  return [
    ["", "No rule"],
    ["contains", "Contains"],
    ["not_contains", "Does not contain"],
    ["equals", "Equals"],
    ["not_equals", "Does not equal"],
    ["begins_with", "Begins with"],
    ["ends_with", "Ends with"],
    ["is_unknown", "Is unknown"],
    ["is_not_unknown", "Is not unknown"],
  ];
}

function renderValuesSection(column, filter) {
  const section = document.createElement("div");
  section.className = "menu-section values-section";

  const heading = document.createElement("div");
  heading.className = "values-heading";
  const label = document.createElement("span");
  label.className = "menu-label";
  label.textContent = "Values";
  const actions = document.createElement("div");
  actions.className = "mini-actions";

  const all = document.createElement("button");
  all.type = "button";
  all.className = "link-button";
  all.textContent = "All";
  all.addEventListener("click", () => {
    filter.selected = null;
    markViewDirty();
    renderRows();
    renderHeaders();
    renderColumnMenu(column.key);
  });

  const none = document.createElement("button");
  none.type = "button";
  none.className = "link-button";
  none.textContent = "None";
  none.addEventListener("click", () => {
    filter.selected = new Set();
    markViewDirty();
    renderRows();
    renderHeaders();
    renderColumnMenu(column.key);
  });

  actions.append(all, none);
  heading.append(label, actions);

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search values";
  search.className = "value-search";

  const list = document.createElement("div");
  list.className = "value-list";
  renderValueList(list, column, filter, "");

  search.addEventListener("input", () => {
    renderValueList(list, column, filter, search.value);
  });

  section.append(heading, search, list);
  return section;
}

function renderValueList(container, column, filter, query) {
  const values = uniqueValues(column);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  container.replaceChildren();

  for (const value of values) {
    const display = displayMenuValue(value, column);
    if (normalizedQuery && !display.toLocaleLowerCase().includes(normalizedQuery)) continue;

    const label = document.createElement("label");
    label.className = "value-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = filter.selected === null || filter.selected.has(value);
    input.addEventListener("change", () => {
      if (filter.selected === null) filter.selected = new Set(values);
      if (input.checked) filter.selected.add(value);
      else filter.selected.delete(value);
      if (filter.selected.size === values.length) filter.selected = null;
      markViewDirty();
      renderRows();
      renderHeaders();
    });

    const text = document.createElement("span");
    text.textContent = display;
    label.append(input, text);
    container.append(label);
  }
}

function uniqueValues(column) {
  const values = new Set(state.screenings.map((screening) => canonicalValue(screening[column.key])));
  return [...values].sort((left, right) => {
    if (left === UNKNOWN) return 1;
    if (right === UNKNOWN) return -1;
    if (column.type === "time") return new Date(left).getTime() - new Date(right).getTime();
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  });
}

function canonicalValue(value) {
  return value == null || value === "" ? UNKNOWN : String(value);
}

function displayMenuValue(value, column) {
  if (value === UNKNOWN) return "Unknown";
  if (column.type !== "time") return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderPreviewSection() {
  const section = document.createElement("div");
  section.className = "menu-section preview-section";

  const heading = document.createElement("div");
  heading.className = "preview-heading";
  const title = document.createElement("span");
  title.className = "menu-label";
  title.textContent = "Preview minutes by chain";
  const note = document.createElement("p");
  note.textContent = "Blank keeps Actual start and Ends unknown for that chain.";
  heading.append(title, note);

  const list = document.createElement("div");
  list.className = "preview-list";

  const chainColumn = columns.find((column) => column.key === "chain");
  const chains = uniqueValues(chainColumn).filter((chain) => chain !== UNKNOWN);
  for (const chain of chains) {
    const label = document.createElement("label");
    label.className = "preview-option";

    const name = document.createElement("span");
    name.textContent = chain;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "180";
    input.step = "1";
    input.placeholder = "Unknown";
    if (state.previewMinutes.has(chain)) input.value = state.previewMinutes.get(chain);

    input.addEventListener("change", async () => {
      const raw = input.value.trim();
      if (raw === "") {
        state.previewMinutes.delete(chain);
      } else {
        const minutes = Number(raw);
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) {
          input.setCustomValidity("Use a whole number from 0 to 180.");
          input.reportValidity();
          return;
        }
        input.setCustomValidity("");
        state.previewMinutes.set(chain, minutes);
      }

      state.filters.actual_start.selected = null;
      state.filters.estimated_end.selected = null;
      markViewDirty();
      await loadScreenings();
    });

    label.append(name, input);
    list.append(label);
  }

  section.append(heading, list);
  return section;
}

function positionColumnMenu(columnKey) {
  const trigger = document.querySelector(`[data-filter-column="${columnKey}"]`);
  const menu = document.getElementById("column-menu");
  if (!trigger || menu.hidden) return;

  const rect = trigger.getBoundingClientRect();
  const menuWidth = Math.min(380, window.innerWidth - 16);
  menu.style.width = `${menuWidth}px`;
  const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  const menuHeight = menu.getBoundingClientRect().height;
  if (rect.bottom + menuHeight + 8 > window.innerHeight && rect.top > menuHeight + 8) {
    menu.style.top = `${rect.top - menuHeight - 4}px`;
  }
}

function isFilterActive(columnKey) {
  const filter = state.filters[columnKey];
  return filter.selected !== null || Boolean(filter.operator);
}

function formatTableTime(value, advertisedStart) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
  const offset = calendarDayOffset(advertisedStart, value);
  if (offset === 0) return formatted;
  return `${formatted} (${offset > 0 ? "+" : ""}${offset}d)`;
}

function calendarDayOffset(baseValue, value) {
  const [baseYear, baseMonth, baseDay] = baseValue.slice(0, 10).split("-").map(Number);
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const base = Date.UTC(baseYear, baseMonth - 1, baseDay);
  const current = Date.UTC(year, month - 1, day);
  return Math.round((current - base) / 86400000);
}

function readSavedViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedViews(views) {
  localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
}

function serializeCurrentView() {
  return {
    sort: { ...state.sort },
    previewMinutes: Object.fromEntries(state.previewMinutes),
    filters: Object.fromEntries(
      columns.map((column) => {
        const filter = state.filters[column.key];
        return [
          column.key,
          {
            selected: filter.selected === null ? null : [...filter.selected],
            operator: filter.operator,
            operand: filter.operand,
          },
        ];
      }),
    ),
  };
}

function renderSavedViews(selectedName = "") {
  const select = document.getElementById("saved-view-select");
  const deleteButton = document.getElementById("delete-view");
  const views = readSavedViews();
  const names = Object.keys(views).sort((left, right) => left.localeCompare(right));

  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Saved views";
  select.append(placeholder);

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }

  select.value = names.includes(selectedName) ? selectedName : "";
  deleteButton.disabled = !select.value;
}

function markViewDirty() {
  const select = document.getElementById("saved-view-select");
  if (!select) return;
  select.value = "";
  document.getElementById("delete-view").disabled = true;
}

function saveCurrentView() {
  const rawName = window.prompt("Name this filter view:");
  if (rawName === null) return;
  const name = rawName.trim();
  if (!name) return;

  const views = readSavedViews();
  if (views[name] && !window.confirm(`Replace saved view “${name}”?`)) return;
  views[name] = serializeCurrentView();
  writeSavedViews(views);
  renderSavedViews(name);
}

async function applySavedView(name) {
  if (!name) {
    document.getElementById("delete-view").disabled = true;
    return;
  }

  const saved = readSavedViews()[name];
  if (!saved) {
    renderSavedViews();
    return;
  }

  if (saved.sort && columns.some((column) => column.key === saved.sort.key)) {
    state.sort = {
      key: saved.sort.key,
      direction: saved.sort.direction === "desc" ? "desc" : "asc",
    };
  }

  for (const column of columns) {
    const savedFilter = saved.filters?.[column.key] || {};
    state.filters[column.key] = {
      selected: Array.isArray(savedFilter.selected) ? new Set(savedFilter.selected) : null,
      operator: typeof savedFilter.operator === "string" ? savedFilter.operator : "",
      operand: typeof savedFilter.operand === "string" ? savedFilter.operand : "",
    };
  }

  state.previewMinutes = new Map(
    Object.entries(saved.previewMinutes || {})
      .map(([chain, minutes]) => [chain, Number(minutes)])
      .filter(([, minutes]) => Number.isInteger(minutes) && minutes >= 0 && minutes <= 180),
  );

  closeColumnMenu();
  await loadScreenings();
  renderSavedViews(name);
}

function deleteSelectedView() {
  const select = document.getElementById("saved-view-select");
  const name = select.value;
  if (!name) return;
  if (!window.confirm(`Delete saved view “${name}”?`)) return;

  const views = readSavedViews();
  delete views[name];
  writeSavedViews(views);
  renderSavedViews();
}

document.addEventListener("click", (event) => {
  const menu = document.getElementById("column-menu");
  if (!menu.hidden && !menu.contains(event.target)) closeColumnMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.openColumn) closeColumnMenu();
});

window.addEventListener("resize", () => {
  if (state.openColumn) positionColumnMenu(state.openColumn);
});

document.getElementById("save-view").addEventListener("click", saveCurrentView);
document.getElementById("delete-view").addEventListener("click", deleteSelectedView);
document.getElementById("saved-view-select").addEventListener("change", (event) => {
  applySavedView(event.target.value);
});

renderSavedViews();
renderHeaders();
loadScreenings();
