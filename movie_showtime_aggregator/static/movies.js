const MOVIE_SELECTION_KEY = "movie-showtime-aggregator.selected-movies.v1";

let movies = [];
let selectedMovies = readSelection();

function browserDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readSelection() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOVIE_SELECTION_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSelection() {
  localStorage.setItem(MOVIE_SELECTION_KEY, JSON.stringify([...selectedMovies].sort()));
}

async function loadMovies() {
  const error = document.getElementById("movie-selection-error");
  error.hidden = true;
  try {
    const response = await fetch(`/api/screenings?date=${browserDate()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);

    const unique = new Map();
    for (const screening of payload.screenings || []) {
      const existing = unique.get(screening.movie);
      if (!existing || (!existing.poster_url && screening.poster_url)) {
        unique.set(screening.movie, screening);
      }
    }
    movies = [...unique.values()];
    renderMovies();

    if (!payload.preferences?.omdb_api_key_set) {
      error.textContent = "Add an OMDb API key in Settings to load posters and ratings.";
      error.hidden = false;
    }
  } catch (err) {
    movies = [];
    renderMovies();
    error.textContent = err.message;
    error.hidden = false;
  }
}

function sortedMovies() {
  const key = document.getElementById("movie-sort").value;
  return [...movies].sort((left, right) => {
    if (key === "title") {
      return left.movie.localeCompare(right.movie, undefined, { numeric: true, sensitivity: "base" });
    }
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue == null && rightValue == null) return left.movie.localeCompare(right.movie);
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const difference = Number(rightValue) - Number(leftValue);
    return difference || left.movie.localeCompare(right.movie);
  });
}

function renderMovies() {
  const grid = document.getElementById("movie-grid");
  grid.replaceChildren();

  if (!movies.length) {
    const empty = document.createElement("p");
    empty.className = "movie-selection-message";
    empty.textContent = "No movies are playing in the current theater search.";
    grid.append(empty);
    updateSelectedCount();
    return;
  }

  for (const movie of sortedMovies()) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "movie-poster-tile";
    tile.dataset.movie = movie.movie;
    tile.setAttribute("aria-pressed", String(selectedMovies.has(movie.movie)));
    tile.setAttribute("aria-label", `${selectedMovies.has(movie.movie) ? "Deselect" : "Select"} ${movie.movie}`);
    if (selectedMovies.has(movie.movie)) tile.classList.add("selected");

    const frame = document.createElement("span");
    frame.className = "movie-poster-frame";
    if (movie.poster_url) {
      const image = document.createElement("img");
      image.src = movie.poster_url;
      image.alt = `${movie.movie} poster`;
      image.loading = "lazy";
      frame.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "movie-poster-placeholder";
      placeholder.textContent = movie.movie;
      frame.append(placeholder);
    }

    const check = document.createElement("span");
    check.className = "movie-poster-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    frame.append(check);

    const title = document.createElement("span");
    title.className = "movie-poster-title";
    title.textContent = movie.movie;
    tile.append(frame, title);

    tile.addEventListener("click", () => {
      if (selectedMovies.has(movie.movie)) selectedMovies.delete(movie.movie);
      else selectedMovies.add(movie.movie);
      writeSelection();
      renderMovies();
    });

    grid.append(tile);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  const count = selectedMovies.size;
  document.getElementById("selected-count").textContent =
    `${count} selected${count ? " · table filter active" : ""}`;
}

document.getElementById("movie-sort").addEventListener("change", renderMovies);
window.addEventListener("storage", (event) => {
  if (event.key !== MOVIE_SELECTION_KEY) return;
  selectedMovies = readSelection();
  renderMovies();
});

loadMovies();
