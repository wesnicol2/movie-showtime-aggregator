const state = {
  facets: { movies: [], theatres: [], formats: [], chains: [] },
  selected: { movies: null, theatres: null, formats: null },
  previewMinutes: new Map(),
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

  for (const [chain, minutes] of state.previewMinutes.entries()) {
    params.append("preview", `${chain}:${minutes}`);
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

    syncFacets(payload.facets);
    renderRows(payload.screenings);
    document.getElementById("result-count").textContent =
      `${payload.count} of ${payload.total_count} screenings · ZIP ${payload.market_zip}`;
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
  state.facets.chains = facets.chains || [];
  renderChainPreviews();
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

function renderChainPreviews() {
  const container = document.getElementById("chain-previews");
  container.replaceChildren();

  for (const chain of state.facets.chains) {
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
    input.addEventListener("change", () => {
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
      loadScreenings();
    });

    label.append(name, input);
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
      cell(screening.chain),
      cell(formatTime(screening.advertised_start), "muted"),
      cell(screening.actual_start ? formatTime(screening.actual_start) : "Unknown", "primary-time"),
      cell(screening.estimated_end ? formatTime(screening.estimated_end) : "Unknown", "primary-time"),
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
