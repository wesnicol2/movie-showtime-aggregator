const SETTINGS_KEY = "movie-showtime-aggregator.settings.v1";
const PREVIEW_COOKIE = "movie_preview_minutes";

function browserDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function validPreviewMinutes(value) {
  return Number.isInteger(value) && value >= 0 && value <= 180;
}

function readPreviewMinutes() {
  const stored = readSettings().previewMinutes;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

  return Object.fromEntries(
    Object.entries(stored)
      .map(([chain, minutes]) => [chain, Number(minutes)])
      .filter(([chain, minutes]) => chain.trim() && validPreviewMinutes(minutes)),
  );
}

function writePreviewCookie(previewMinutes) {
  const encoded = encodeURIComponent(JSON.stringify(previewMinutes));
  document.cookie = `${PREVIEW_COOKIE}=${encoded}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function savePreviewMinutes(previewMinutes) {
  const current = readSettings();
  current.previewMinutes = previewMinutes;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  writePreviewCookie(previewMinutes);
}

function renderChains(chains, previewMinutes) {
  const container = document.getElementById("preview-settings");
  container.replaceChildren();

  if (!chains.length) {
    const empty = document.createElement("p");
    empty.textContent = "No theater chains were returned for today's market.";
    container.append(empty);
    return;
  }

  for (const chain of chains) {
    const row = document.createElement("label");
    row.className = "settings-row";
    row.dataset.chain = chain;

    const text = document.createElement("span");
    text.textContent = chain;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "180";
    input.step = "1";
    input.placeholder = "Unknown";
    input.setAttribute("aria-label", `Preview minutes for ${chain}`);
    if (Object.hasOwn(previewMinutes, chain)) input.value = previewMinutes[chain];

    row.append(text, input);
    container.append(row);
  }
}

function collectPreviewMinutes() {
  const previewMinutes = {};

  for (const row of document.querySelectorAll(".settings-row")) {
    const input = row.querySelector("input");
    const raw = input.value.trim();
    input.setCustomValidity("");
    if (!raw) continue;

    const minutes = Number(raw);
    if (!validPreviewMinutes(minutes)) {
      input.setCustomValidity("Use a whole number from 0 to 180.");
      input.reportValidity();
      return null;
    }
    previewMinutes[row.dataset.chain] = minutes;
  }

  return previewMinutes;
}

async function loadSettingsPage() {
  const error = document.getElementById("settings-error");
  const storedPreviewMinutes = readPreviewMinutes();
  writePreviewCookie(storedPreviewMinutes);

  try {
    const response = await fetch(`/api/screenings?date=${browserDate()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);

    const chains = [...(payload.facets?.chains || [])].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
    renderChains(chains, storedPreviewMinutes);
  } catch (err) {
    document.getElementById("preview-settings").replaceChildren();
    error.textContent = err.message;
    error.hidden = false;
  }
}

document.getElementById("save-settings").addEventListener("click", () => {
  const previewMinutes = collectPreviewMinutes();
  if (previewMinutes === null) return;

  savePreviewMinutes(previewMinutes);
  document.getElementById("settings-status").textContent = "Saved";
});

document.getElementById("clear-settings").addEventListener("click", () => {
  for (const input of document.querySelectorAll(".settings-row input")) input.value = "";
  savePreviewMinutes({});
  document.getElementById("settings-status").textContent = "Preview times cleared";
});

loadSettingsPage();
