import { useCallback, useEffect, useState } from "react";

import { findNearbyLocation, type NearbyLocation } from "./api";
import {
  addBrowserHome,
  LOCATION_CHANGED_EVENT,
  readBrowserSettings,
  saveBrowserSettings,
} from "./browser-location";

const IGNORED_KEY = "movie-showtime-aggregator.travel-ignored.v1";

export function LocationAssistant() {
  const insecureOrigin = window.isSecureContext === false;
  const [nearby, setNearby] = useState<NearbyLocation | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualZip, setManualZip] = useState(readBrowserSettings().location?.zipCode ?? "");
  const [currentZip, setCurrentZip] = useState(readBrowserSettings().location?.zipCode ?? "");

  const detect = useCallback((explicit: boolean): void => {
    if (window.isSecureContext === false || !navigator.geolocation) {
      if (explicit) {
        setManualOpen(true);
        setError("");
      }
      return;
    }
    setChecking(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void findNearbyLocation(position.coords.latitude, position.coords.longitude)
          .then((result) => {
            const threshold = Math.max(30, result.radius_miles * 1.25);
            const farAway =
              result.distance_from_search_miles !== null &&
              result.distance_from_search_miles > threshold;
            const declined = sessionStorage.getItem(IGNORED_KEY) === result.zip_code;
            if (explicit || (farAway && !declined)) {
              setNearby(result);
              setManualOpen(false);
            }
          })
          .catch((caught: unknown) => {
            if (explicit) {
              setError(
                caught instanceof Error ? caught.message : "Could not locate nearby theaters",
              );
              setManualOpen(true);
            }
          })
          .finally(() => setChecking(false));
      },
      (failure) => {
        setChecking(false);
        if (explicit) {
          setError(
            failure.code === 1
              ? "Location permission was denied. You can still enter a ZIP code."
              : failure.message || "Could not determine your location.",
          );
          setManualOpen(true);
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  useEffect(() => {
    const syncZip = () => {
      const zip = readBrowserSettings().location?.zipCode ?? "";
      setCurrentZip(zip);
      setManualZip(zip);
    };
    window.addEventListener(LOCATION_CHANGED_EVENT, syncZip);
    return () => window.removeEventListener(LOCATION_CHANGED_EVENT, syncZip);
  }, []);

  useEffect(() => {
    // HTTP on a network hostname/IP is not a secure context. Never ask for
    // permission or call geolocation there: the browser will always block it.
    if (window.isSecureContext === false || !navigator.permissions?.query) return;
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (permission.state === "granted") detect(false);
      })
      .catch(() => {});
  }, [detect]);

  function apply(searchOnly: boolean): void {
    if (!nearby?.zip_code) return;
    const location = {
      zipCode: nearby.zip_code,
      radiusMiles: readBrowserSettings().location?.radiusMiles ?? nearby.radius_miles,
    };
    if (searchOnly) {
      const settings = readBrowserSettings();
      settings.location = location;
      saveBrowserSettings(settings);
    } else {
      addBrowserHome(
        {
          label: nearby.display_name,
          latitude: nearby.latitude,
          longitude: nearby.longitude,
        },
        location,
      );
    }
    setCurrentZip(location.zipCode);
    setNearby(null);
  }

  function applyManualZip(): void {
    const zip = manualZip.trim();
    if (!/^\d{5}$/.test(zip)) {
      setError("Enter a valid five-digit US ZIP code.");
      return;
    }
    const settings = readBrowserSettings();
    settings.location = {
      zipCode: zip,
      radiusMiles: settings.location?.radiusMiles ?? 25,
    };
    saveBrowserSettings(settings);
    setCurrentZip(zip);
    setError("");
    setNearby(null);
    setManualOpen(false);
  }

  function dismiss(): void {
    if (nearby?.zip_code) sessionStorage.setItem(IGNORED_KEY, nearby.zip_code);
    setNearby(null);
  }

  return (
    <div className="location-assistant">
      {insecureOrigin ? (
        <button
          type="button"
          className="location-check"
          aria-expanded={manualOpen}
          onClick={() => {
            setManualOpen(true);
            setError("");
          }}
        >
          Set location
        </button>
      ) : (
        <>
          <button
            type="button"
            className="location-check"
            disabled={checking}
            onClick={() => detect(true)}
            aria-label="Check my current location for nearby theaters"
          >
            {checking ? "Locating…" : "Use current location"}
          </button>
          <button
            type="button"
            className="location-check"
            aria-expanded={manualOpen}
            onClick={() => {
              setManualOpen(true);
              setError("");
            }}
          >
            Enter ZIP
          </button>
        </>
      )}
      {currentZip ? <span className="location-zip">Theaters near {currentZip}</span> : null}
      {manualOpen ? (
        <section className="location-suggestion" aria-label="Set theater location manually">
          <strong>
            {insecureOrigin ? "Automatic location needs HTTPS" : "Set theater location"}
          </strong>
          <p>
            {insecureOrigin
              ? "This site is open on an insecure address. Browsers block device location here. Enter a ZIP code, or use an HTTPS address for automatic location."
              : "Enter a ZIP code if device location is unavailable or you prefer to choose a city."}
          </p>
          <form
            className="location-manual-form"
            onSubmit={(event) => {
              event.preventDefault();
              applyManualZip();
            }}
          >
            <label htmlFor="location-manual-zip">Theater ZIP code</label>
            <div className="location-manual-row">
              <input
                id="location-manual-zip"
                aria-label="Theater ZIP code"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                placeholder="e.g. 80202"
                value={manualZip}
                onChange={(event) => setManualZip(event.target.value)}
              />
              <button type="submit" className="primary">
                Search here
              </button>
            </div>
          </form>
          <p>
            Need routes from a hotel?{" "}
            <a href="/settings">Add a home or hotel address in Settings</a>.
          </p>
          <button type="button" onClick={() => setManualOpen(false)}>
            Close
          </button>
        </section>
      ) : null}
      {nearby ? (
        <section className="location-suggestion" aria-label="Travel location suggestion">
          <div>
            <strong>{nearby.city || "Different location"} detected</strong>
            <p>
              You are searching near {nearby.search_zip_code}. Would you like to add your current
              location as a home for travel routes, and search for theaters here?
            </p>
            <small>
              {nearby.display_name}. Device location may be approximate; you can enter your hotel
              address in Settings instead.
            </small>
            {!nearby.zip_code ? (
              <p role="alert">A nearby ZIP could not be determined. Enter it in Settings.</p>
            ) : null}
          </div>
          <div className="location-suggestion-actions">
            <button
              type="button"
              className="primary"
              disabled={!nearby.zip_code}
              onClick={() => apply(false)}
            >
              Add as home & search here
            </button>
            <button type="button" disabled={!nearby.zip_code} onClick={() => apply(true)}>
              Change theaters only
            </button>
            <button type="button" onClick={dismiss}>
              Not now
            </button>
          </div>
        </section>
      ) : null}
      {error ? (
        <span className="location-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
