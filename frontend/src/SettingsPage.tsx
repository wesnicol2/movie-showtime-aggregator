import { useEffect, useMemo, useState } from "react";

import { fetchScreenings, fetchSharedSettings, saveSharedSettings } from "./api";
import { useAppStore } from "./store";
import type { ProviderUsage, SharedSettings } from "./types";

const SETTINGS_KEY = "movie-showtime-aggregator.settings.v1";
const PREVIEW_COOKIE = "movie_preview_minutes";
const LOCATION_COOKIE = "movie_location";

interface BrowserLocation {
  zipCode: string;
  radiusMiles: number;
}

interface BrowserSettings {
  previewMinutes?: Record<string, number>;
  location?: BrowserLocation;
}

function readBrowserSettings(): BrowserSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BrowserSettings)
      : {};
  } catch {
    return {};
  }
}

function writeBrowserSettings(settings: BrowserSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function writeCookie(name: string, value: unknown): void {
  // biome-ignore lint/suspicious/noDocumentCookie: The Python screening endpoint synchronously reads this compatibility cookie.
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function timeUntil(timestamp?: string | null): string {
  if (!timestamp) return "unknown";
  const milliseconds = Date.parse(timestamp) - Date.now();
  if (!Number.isFinite(milliseconds)) return "unknown";
  if (milliseconds <= 0) return "due now";
  const totalMinutes = Math.ceil(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
}

function usageText(name: "OMDb" | "AMC", usage?: ProviderUsage): string {
  if (!usage) return "Usage unavailable";
  const requests = (usage.requests_today ?? 0).toLocaleString();
  const hits = (usage.cache_hits_today ?? 0).toLocaleString();
  if (name === "OMDb") {
    const remaining = usage.estimated_remaining_today;
    const percent = usage.published_percent_used;
    return `${requests} requests · ${hits} cache hits · ${remaining ?? "?"} estimated remaining${percent == null ? "" : ` · ${Number(percent).toFixed(1)}% used`} · app counter resets in ${timeUntil(usage.app_counter_reset_at)}`;
  }
  const provider = usage.provider_rate_limit;
  const quota =
    provider?.limit != null && provider.remaining != null
      ? ` · provider reports ${provider.remaining} / ${provider.limit} remaining${provider.reset_at ? ` · resets in ${timeUntil(provider.reset_at)}` : ""}`
      : " · provider quota not published";
  return `${requests} requests · ${hits} cache hits${quota} · app counter rolls in ${timeUntil(usage.app_counter_reset_at)}`;
}

export function SettingsPage() {
  const invalidateScreenings = useAppStore((state) => state.invalidateScreenings);
  const initialBrowser = useMemo(readBrowserSettings, []);
  const [zipCode, setZipCode] = useState(initialBrowser.location?.zipCode ?? "");
  const [radiusMiles, setRadiusMiles] = useState(
    String(initialBrowser.location?.radiusMiles ?? ""),
  );
  const [previewMinutes, setPreviewMinutes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialBrowser.previewMinutes ?? {}).map(([chain, value]) => [
        chain,
        String(value),
      ]),
    ),
  );
  const [chains, setChains] = useState<string[]>([]);
  const [shared, setShared] = useState<SharedSettings | null>(null);
  const [homeAddress, setHomeAddress] = useState("");
  const [amcKey, setAmcKey] = useState("");
  const [omdbKey, setOmdbKey] = useState("");
  const [aList, setAList] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadSettings(): Promise<void> {
    setError("");
    const browser = readBrowserSettings();
    writeCookie(PREVIEW_COOKIE, browser.previewMinutes ?? {});
    if (browser.location) writeCookie(LOCATION_COOKIE, browser.location);
    try {
      const [sharedPayload, screeningPayload] = await Promise.all([
        fetchSharedSettings(),
        fetchScreenings(false),
      ]);
      setShared(sharedPayload);
      setHomeAddress(sharedPayload.home_address ?? "");
      setAList(sharedPayload.amc_a_list === true);
      setChains(
        [...screeningPayload.facets.chains].sort((left, right) => left.localeCompare(right)),
      );
      if (!browser.location) {
        setZipCode(screeningPayload.location.zip_code);
        setRadiusMiles(String(screeningPayload.location.radius_miles));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load settings");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Settings are intentionally loaded once; explicit refreshes call loadSettings directly.
  useEffect(() => {
    void loadSettings();
  }, []);

  async function persistShared(
    changes: Parameters<typeof saveSharedSettings>[0],
    success: string,
  ): Promise<void> {
    setStatus("Saving…");
    try {
      const payload = await saveSharedSettings(changes);
      setShared(payload);
      setHomeAddress(payload.home_address ?? "");
      setAList(payload.amc_a_list === true);
      setAmcKey("");
      setOmdbKey("");
      invalidateScreenings();
      setStatus(success);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Save failed");
    }
  }

  async function saveLocation(): Promise<void> {
    const radius = Number(radiusMiles);
    if (!/^\d{5}$/.test(zipCode)) {
      setStatus("Use a five-digit US ZIP code.");
      return;
    }
    if (!Number.isInteger(radius) || radius < 1 || radius > 100) {
      setStatus("Use a whole-number radius from 1 to 100 miles.");
      return;
    }
    const current = readBrowserSettings();
    const location = { zipCode, radiusMiles: radius };
    current.location = location;
    writeBrowserSettings(current);
    writeCookie(LOCATION_COOKIE, location);
    invalidateScreenings();
    setStatus("Saved · refreshing theaters…");
    try {
      const payload = await fetchScreenings(false);
      setChains([...payload.facets.chains].sort((left, right) => left.localeCompare(right)));
      setStatus("Saved");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Saved, but theater refresh failed");
    }
  }

  function savePreviews(): void {
    const parsed: Record<string, number> = {};
    for (const [chain, raw] of Object.entries(previewMinutes)) {
      if (!raw.trim()) continue;
      const minutes = Number(raw);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) {
        setStatus(`Preview minutes for ${chain} must be a whole number from 0 to 180.`);
        return;
      }
      parsed[chain] = minutes;
    }
    const current = readBrowserSettings();
    current.previewMinutes = parsed;
    writeBrowserSettings(current);
    writeCookie(PREVIEW_COOKIE, parsed);
    invalidateScreenings();
    setStatus("Preview times saved");
  }

  function clearPreviews(): void {
    setPreviewMinutes({});
    const current = readBrowserSettings();
    current.previewMinutes = {};
    writeBrowserSettings(current);
    writeCookie(PREVIEW_COOKIE, {});
    invalidateScreenings();
    setStatus("Preview times cleared");
  }

  return (
    <section className="workspace settings-workspace" aria-labelledby="settings-heading">
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">CONFIGURATION</p>
          <h1 id="settings-heading">Settings</h1>
        </div>
        <span className="settings-status" role="status">
          {status}
        </span>
      </div>
      {error ? (
        <div className="status-strip error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Theater search</h2>
            <p>Controls which theaters are returned for this browser.</p>
          </div>
          <span className="scope-badge">This browser</span>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>ZIP code</span>
            <input
              value={zipCode}
              inputMode="numeric"
              maxLength={5}
              onChange={(event) => setZipCode(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Radius (miles)</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={radiusMiles}
              onChange={(event) => setRadiusMiles(event.target.value)}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button className="primary" type="button" onClick={() => void saveLocation()}>
            Save theater search
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Home & travel</h2>
            <p>The server geocodes this address and uses it for backend-owned travel timing.</p>
          </div>
          <span className="scope-badge shared">Shared server</span>
        </div>
        <label className="field wide">
          <span>Home address</span>
          <input
            value={homeAddress}
            autoComplete="street-address"
            placeholder="Street address, city, state ZIP"
            onChange={(event) => setHomeAddress(event.target.value)}
          />
        </label>
        <div className="readonly-row">
          <span>Matched address</span>
          <strong>{shared?.home_display_name || "Not configured"}</strong>
        </div>
        <div className="settings-actions">
          <button
            className="primary"
            type="button"
            onClick={() => void persistShared({ home_address: homeAddress.trim() }, "Home saved")}
          >
            Save home
          </button>
          <button
            type="button"
            onClick={() => void persistShared({ home_address: "" }, "Home cleared")}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Preview time by chain</h2>
            <p>
              Minutes between listed showtime and actual movie start. Blank keeps derived times
              unknown.
            </p>
          </div>
          <span className="scope-badge">This browser</span>
        </div>
        <div className="preview-list">
          {chains.length === 0 ? (
            <p className="muted">No theater chains returned for this location today.</p>
          ) : (
            chains.map((chain) => (
              <label className="preview-row" key={chain}>
                <span>{chain}</span>
                <input
                  type="number"
                  min={0}
                  max={180}
                  step={1}
                  placeholder="Unknown"
                  aria-label={`Preview minutes for ${chain}`}
                  value={previewMinutes[chain] ?? ""}
                  onChange={(event) =>
                    setPreviewMinutes((current) => ({ ...current, [chain]: event.target.value }))
                  }
                />
              </label>
            ))
          )}
        </div>
        <div className="settings-actions">
          <button className="primary" type="button" onClick={savePreviews}>
            Save preview times
          </button>
          <button type="button" onClick={clearPreviews}>
            Clear
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>Data integrations</h2>
            <p>
              Saved keys are write-only: the browser can replace or clear them but never read them
              back.
            </p>
          </div>
          <span className="scope-badge shared">Shared server</span>
        </div>
        <div className="settings-grid single-column">
          <label className="field">
            <span>AMC developer key</span>
            <input
              type="password"
              autoComplete="off"
              value={amcKey}
              placeholder={
                shared?.amc_vendor_key_set ? "Saved · enter new key to replace" : "Not configured"
              }
              onChange={(event) => setAmcKey(event.target.value)}
            />
          </label>
          <label className="toggle-field">
            <span>AMC A-List</span>
            <input
              type="checkbox"
              checked={aList}
              onChange={(event) => setAList(event.target.checked)}
            />
          </label>
          <label className="field">
            <span>OMDb API key</span>
            <input
              type="password"
              autoComplete="off"
              value={omdbKey}
              placeholder={
                shared?.omdb_api_key_set ? "Saved · enter new key to replace" : "Not configured"
              }
              onChange={(event) => setOmdbKey(event.target.value)}
            />
          </label>
        </div>
        <div className="usage-row">
          <span>OMDb usage</span>
          <strong>
            {shared?.omdb_api_key_set
              ? usageText("OMDb", shared.provider_usage?.omdb)
              : "Not configured"}
          </strong>
        </div>
        <div className="usage-row">
          <span>AMC usage</span>
          <strong>
            {shared?.amc_vendor_key_set
              ? usageText("AMC", shared.provider_usage?.amc)
              : "Not configured"}
          </strong>
        </div>
        <p className="settings-note">
          OMDb publishes a 1,000-request daily limit but not an exact provider reset time. AMC quota
          percentages and reset times are shown only when AMC sends them.
        </p>
        <div className="settings-actions wrap">
          <button
            className="primary"
            type="button"
            onClick={() =>
              void persistShared(
                {
                  amc_a_list: aList,
                  ...(amcKey.trim() ? { amc_vendor_key: amcKey.trim() } : {}),
                  ...(omdbKey.trim() ? { omdb_api_key: omdbKey.trim() } : {}),
                },
                "Integrations saved",
              )
            }
          >
            Save integrations
          </button>
          <button
            type="button"
            onClick={() => void loadSettings().then(() => setStatus("Usage refreshed"))}
          >
            Refresh usage
          </button>
          <button
            type="button"
            disabled={!shared?.amc_vendor_key_set}
            onClick={() => void persistShared({ clear_amc_vendor_key: true }, "AMC key cleared")}
          >
            Clear AMC key
          </button>
          <button
            type="button"
            disabled={!shared?.omdb_api_key_set}
            onClick={() => void persistShared({ clear_omdb_api_key: true }, "OMDb key cleared")}
          >
            Clear OMDb key
          </button>
        </div>
      </div>
    </section>
  );
}
