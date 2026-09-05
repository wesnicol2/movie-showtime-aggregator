const SETTINGS_KEY = "movie-showtime-aggregator.settings.v1";
const PREVIEW_COOKIE = "movie_preview_minutes";
const LOCATION_COOKIE = "movie_location";
let latestSharedSettings = null;

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

function validLocation(location) {
  return Boolean(
    location
    && typeof location === "object"
    && !Array.isArray(location)
    && typeof location.zipCode === "string"
    && /^[0-9]{5}$/.test(location.zipCode)
    && Number.isInteger(Number(location.radiusMiles))
    && Number(location.radiusMiles) >= 1
    && Number(location.radiusMiles) <= 100,
  );
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

function readLocation() {
  const stored = readSettings().location;
  if (!validLocation(stored)) return null;
  return {
    zipCode: stored.zipCode,
    radiusMiles: Number(stored.radiusMiles),
  };
}

function writeJsonCookie(name, value) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  document.cookie = `${name}=${encoded}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function savePreviewMinutes(previewMinutes) {
  const current = readSettings();
  current.previewMinutes = previewMinutes;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  writeJsonCookie(PREVIEW_COOKIE, previewMinutes);
}

function saveLocation(location) {
  const current = readSettings();
  current.location = location;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  writeJsonCookie(LOCATION_COOKIE, location);
}

function setLocationInputs(location) {
  if (!location) return;
  const zipCode = location.zip_code || location.zipCode;
  const radiusMiles = location.radius_miles ?? location.radiusMiles;
  if (typeof zipCode === "string") document.getElementById("location-zip").value = zipCode;
  if (radiusMiles != null) document.getElementById("location-radius").value = radiusMiles;
}

function collectLocation() {
  const zipInput = document.getElementById("location-zip");
  const radiusInput = document.getElementById("location-radius");
  const zipCode = zipInput.value.trim();
  const radiusMiles = Number(radiusInput.value);

  zipInput.setCustomValidity("");
  radiusInput.setCustomValidity("");

  if (!/^[0-9]{5}$/.test(zipCode)) {
    zipInput.setCustomValidity("Use a five-digit US ZIP code.");
    zipInput.reportValidity();
    return null;
  }

  if (!Number.isInteger(radiusMiles) || radiusMiles < 1 || radiusMiles > 100) {
    radiusInput.setCustomValidity("Use a whole number from 1 to 100.");
    radiusInput.reportValidity();
    return null;
  }

  return { zipCode, radiusMiles };
}

function renderChains(chains, previewMinutes) {
  const container = document.getElementById("preview-settings");
  container.replaceChildren();

  if (!chains.length) {
    const empty = document.createElement("p");
    empty.className = "settings-loading";
    empty.textContent = "No theater chains were returned for this location today.";
    container.append(empty);
    return;
  }

  for (const chain of chains) {
    const row = document.createElement("label");
    row.className = "settings-row preview-settings-row";
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

  for (const row of document.querySelectorAll(".preview-settings-row")) {
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

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
}

function timeUntil(timestamp) {
  if (!timestamp) return "unknown";
  const milliseconds = Date.parse(timestamp) - Date.now();
  if (!Number.isFinite(milliseconds)) return "unknown";
  if (milliseconds <= 0) return "due now";

  const totalMinutes = Math.ceil(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function setUsageProgress(id, percent) {
  const progress = document.getElementById(id);
  if (Number.isFinite(Number(percent))) {
    progress.value = Math.max(0, Math.min(100, Number(percent)));
  } else {
    progress.removeAttribute("value");
  }
}

function providerWindowText(rateLimit) {
  if (!rateLimit || typeof rateLimit !== "object") return "";
  const limit = Number(rateLimit.limit);
  const remaining = Number(rateLimit.remaining);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return "";
  const reset = rateLimit.reset_at ? ` · provider resets in ${timeUntil(rateLimit.reset_at)}` : "";
  return ` · provider reports ${formatNumber(remaining)} / ${formatNumber(limit)} remaining${reset}`;
}

function renderProviderUsage(settings) {
  const usage = settings?.provider_usage || {};
  const omdb = usage.omdb || {};
  const amc = usage.amc || {};

  const omdbOutput = document.getElementById("omdb-usage");
  if (!settings?.omdb_api_key_set) {
    setUsageProgress("omdb-usage-progress", 0);
    omdbOutput.textContent = "Not configured";
  } else {
    const percent = Number(omdb.published_percent_used);
    setUsageProgress("omdb-usage-progress", percent);
    const percentText = Number.isFinite(percent) ? `${percent.toFixed(1)}%` : "unknown %";
    omdbOutput.textContent = `${formatNumber(omdb.requests_today)} / 1,000 requests (${percentText}) · ${formatNumber(omdb.estimated_remaining_today)} estimated remaining · ${formatNumber(omdb.cache_hits_today)} cache hits · app counter resets in ${timeUntil(omdb.app_counter_reset_at)}${providerWindowText(omdb.provider_rate_limit)}`;
  }

  const amcOutput = document.getElementById("amc-usage");
  if (!settings?.amc_vendor_key_set) {
    setUsageProgress("amc-usage-progress", null);
    amcOutput.textContent = "Not configured";
  } else {
    const providerPercent = Number(amc.provider_rate_limit?.percent_used);
    setUsageProgress("amc-usage-progress", Number.isFinite(providerPercent) ? providerPercent : null);
    const providerText = providerWindowText(amc.provider_rate_limit);
    const quotaText = providerText
      ? providerText.slice(3)
      : "quota percentage/reset not published by AMC";
    amcOutput.textContent = `${formatNumber(amc.requests_today)} requests today · ${formatNumber(amc.cache_hits_today)} cache hits · ${quotaText} · app counter rolls in ${timeUntil(amc.app_counter_reset_at)}`;
  }
}

async function fetchSharedSettings() {
  const response = await fetch("/api/settings");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function loadSharedSettings() {
  const payload = await fetchSharedSettings();
  renderSharedSettings(payload);
  return payload;
}

async function refreshProviderUsage() {
  const payload = await fetchSharedSettings();
  latestSharedSettings = payload;
  renderProviderUsage(payload);
  return payload;
}

function renderSharedSettings(settings) {
  latestSharedSettings = settings;
  document.getElementById("home-address").value = settings.home_address || "";
  document.getElementById("home-match").textContent = settings.home_display_name || "Not configured";
  document.getElementById("amc-a-list").checked = settings.amc_a_list === true;

  const amc = document.getElementById("amc-key");
  const omdb = document.getElementById("omdb-key");
  amc.value = "";
  omdb.value = "";
  amc.placeholder = settings.amc_vendor_key_set ? "Saved · enter a new key to replace" : "Not configured";
  omdb.placeholder = settings.omdb_api_key_set ? "Saved · enter a new key to replace" : "Not configured";
  document.getElementById("clear-amc-key").disabled = !settings.amc_vendor_key_set;
  document.getElementById("clear-omdb-key").disabled = !settings.omdb_api_key_set;
  renderProviderUsage(settings);
}

async function saveSharedSettings(changes) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  renderSharedSettings(payload);
  return payload;
}

async function loadScreeningSettings() {
  const error = document.getElementById("settings-error");
  error.hidden = true;
  const storedPreviewMinutes = readPreviewMinutes();
  const storedLocation = readLocation();

  writeJsonCookie(PREVIEW_COOKIE, storedPreviewMinutes);
  if (storedLocation) writeJsonCookie(LOCATION_COOKIE, storedLocation);
  if (storedLocation) setLocationInputs(storedLocation);

  try {
    const response = await fetch(`/api/screenings?date=${browserDate()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);

    setLocationInputs(payload.location || storedLocation);
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

async function loadSettingsPage() {
  try {
    await loadSharedSettings();
  } catch (err) {
    const error = document.getElementById("settings-error");
    error.textContent = err.message;
    error.hidden = false;
  }
  await loadScreeningSettings();
  try {
    await refreshProviderUsage();
  } catch {
    // Provider usage is informational; the rest of Settings remains usable.
  }
}

document.getElementById("save-location").addEventListener("click", async () => {
  const location = collectLocation();
  if (location === null) return;

  saveLocation(location);
  const status = document.getElementById("location-status");
  status.textContent = "Saved · refreshing theaters…";
  await loadScreeningSettings();
  await refreshProviderUsage().catch(() => {});
  status.textContent = "Saved";
});

document.getElementById("save-home").addEventListener("click", async () => {
  const status = document.getElementById("home-status");
  status.textContent = "Saving…";
  try {
    await saveSharedSettings({ home_address: document.getElementById("home-address").value.trim() });
    status.textContent = "Saved";
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("clear-home").addEventListener("click", async () => {
  const status = document.getElementById("home-status");
  status.textContent = "Clearing…";
  try {
    await saveSharedSettings({ home_address: "" });
    status.textContent = "Cleared";
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("save-settings").addEventListener("click", () => {
  const previewMinutes = collectPreviewMinutes();
  if (previewMinutes === null) return;

  savePreviewMinutes(previewMinutes);
  document.getElementById("settings-status").textContent = "Saved";
});

document.getElementById("clear-settings").addEventListener("click", () => {
  for (const input of document.querySelectorAll(".preview-settings-row input")) input.value = "";
  savePreviewMinutes({});
  document.getElementById("settings-status").textContent = "Preview times cleared";
});

document.getElementById("save-integrations").addEventListener("click", async () => {
  const status = document.getElementById("integration-status");
  const changes = { amc_a_list: document.getElementById("amc-a-list").checked };
  const amcKey = document.getElementById("amc-key").value.trim();
  const omdbKey = document.getElementById("omdb-key").value.trim();
  if (amcKey) changes.amc_vendor_key = amcKey;
  if (omdbKey) changes.omdb_api_key = omdbKey;

  status.textContent = "Saving…";
  try {
    await saveSharedSettings(changes);
    status.textContent = "Saved";
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("refresh-provider-usage").addEventListener("click", async () => {
  const status = document.getElementById("integration-status");
  status.textContent = "Refreshing usage…";
  try {
    await refreshProviderUsage();
    status.textContent = "Usage refreshed";
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("clear-amc-key").addEventListener("click", async () => {
  const status = document.getElementById("integration-status");
  status.textContent = "Clearing AMC key…";
  try {
    await saveSharedSettings({ clear_amc_vendor_key: true });
    status.textContent = "AMC key cleared";
  } catch (err) {
    status.textContent = err.message;
  }
});

document.getElementById("clear-omdb-key").addEventListener("click", async () => {
  const status = document.getElementById("integration-status");
  status.textContent = "Clearing OMDb key…";
  try {
    await saveSharedSettings({ clear_omdb_api_key: true });
    status.textContent = "OMDb key cleared";
  } catch (err) {
    status.textContent = err.message;
  }
});

setInterval(() => {
  if (latestSharedSettings) renderProviderUsage(latestSharedSettings);
}, 30000);

loadSettingsPage();
