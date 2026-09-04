const state = {
  facets: { movies: [], theatres: [], formats: [] },
  selected: { movies: null, theatres: null, formats: null },
};

const facetConfig = {
  movies: { element: "movies-filter", param: "movie" },
  theatres: { element: "theatres-filter", param: "theatre" },
  formats: { element: "formats-filter", param: "format" },
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

  for (const [facet, config] of Object.entries(facetConfig)) {
    const selected = state.selected[facet];
    if (selected === null) continue;
    if (selected.size === 0) {
      params.append(config.param, "__none__");
      continue;
    }
    for (const value of selected) params.append(config.param, value);
  }

  const times = [
    ["start_after", "start-after"],
    ["start_before", "start-before"],
    ["end_by", "end-by"],
  ];
  for (const [param, id] of times) {
    const value = document.getElementById(id).value;
    if (value) params.set(param, value);
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

    document.getElementById("preshow-label").textContent = `${payload.preshow_minutes} minutes`;
    syncFacets(payload.facets);
    renderRows(payload.screenings);
    document.getElementById("result-count").textContent =
      `${payload.count} of ${payload.total_count} screenings`;
  } catch (err) {
    document.getElementById("result-count").textContent = "Unavailable";
    document.getElementById("screenings-body").replaceChildren();
    document.getElementById("empty-state").hidden = true;
    error.textContent = err.message;
    error.hidden = false;
  }
}

function syncFacets(facets) {
  for (const facet of Object.keys(facetConfig)) {
    const values = facets[facet] || [];
    state.facets[facet] = values;
    if (state.selected[facet] === null) state.selected[facet] = new Set(values);
    renderFacet(facet);
  }
}

function renderFacet(facet) {
  const container = document.getElementById(facetConfig[facet].element);
  const selected = state.selected[facet];
  container.replaceChildren();

  for (const value of state.facets[facet]) {
    const label = document.createElement("label");
    label.className = "check-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(value);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(value);
      else selected.delete(value);
      loadScreenings();
    });

    const text = document.createElement("span");
    text.textContent = value;
    label.append(input, text);
    container.append(label);
  }
}

function renderRows(screenings) {
  const body = document.getElementById("screenings-body");
  const empty = document.getElementById("empty-state");
  body.replaceChildren();
  empty.hidden = screenings.length !== 0;

  for (const screening of screenings) {
    const row = document.createElement("tr");
    const movieCell = document.createElement("td");
    if (screening.purchase_url) {
      const link = document.createElement("a");
      link.href = screening.purchase_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = screening.movie;
      movieCell.append(link);
    } else {
      movieCell.textContent = screening.movie;
    }

    row.append(
      movieCell,
      cell(screening.theatre),
      cell(formatTime(screening.advertised_start), "muted"),
      cell(formatTime(screening.actual_start), "primary-time"),
      cell(formatTime(screening.estimated_end), "primary-time"),
      cell(screening.format),
    );
    body.append(row);
  }
}

function cell(text, className = "") {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("click", () => {
    const facet = button.dataset.filter;
    state.selected[facet] = button.dataset.action === "all"
      ? new Set(state.facets[facet])
      : new Set();
    renderFacet(facet);
    loadScreenings();
  });
}

for (const id of ["start-after", "start-before", "end-by"]) {
  document.getElementById(id).addEventListener("change", loadScreenings);
}

document.getElementById("clear-times").addEventListener("click", () => {
  for (const id of ["start-after", "start-before", "end-by"]) {
    document.getElementById(id).value = "";
  }
  loadScreenings();
});

loadScreenings();
