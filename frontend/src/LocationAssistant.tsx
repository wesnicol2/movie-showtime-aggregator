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
  const [nearby, setNearby] = useState<NearbyLocation | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [currentZip, setCurrentZip] = useState(readBrowserSettings().location?.zipCode ?? "");

  const detect = useCallback((explicit: boolean): void => {
    if (!navigator.geolocation) {
      if (explicit) setError("Location is not available in this browser.");
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
            if (explicit || (farAway && !declined)) setNearby(result);
          })
          .catch((caught: unknown) => {
            if (explicit)
              setError(
                caught instanceof Error ? caught.message : "Could not locate nearby theaters",
              );
          })
          .finally(() => setChecking(false));
      },
      (failure) => {
        setChecking(false);
        if (explicit) setError(failure.message || "Location permission denied");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  useEffect(() => {
    const syncZip = () => setCurrentZip(readBrowserSettings().location?.zipCode ?? "");
    window.addEventListener(LOCATION_CHANGED_EVENT, syncZip);
    return () => window.removeEventListener(LOCATION_CHANGED_EVENT, syncZip);
  }, []);

  useEffect(() => {
    // A previously granted location can be checked without another permission prompt.
    // When permission hasn't been granted, only the button below asks for it.
    if (!navigator.permissions?.query) return;
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

  function dismiss(): void {
    if (nearby?.zip_code) sessionStorage.setItem(IGNORED_KEY, nearby.zip_code);
    setNearby(null);
  }

  return (
    <div className="location-assistant">
      <button
        type="button"
        className="location-check"
        disabled={checking}
        onClick={() => detect(true)}
        aria-label="Check my current location for nearby theaters"
      >
        {checking ? "Locating…" : "Use current location"}
      </button>
      {currentZip ? <span className="location-zip">Theaters near {currentZip}</span> : null}
      {nearby ? (
        <section className="location-suggestion" aria-label="Travel location suggestion">
          <div>
            <strong>{nearby.city || "Different location"} detected</strong>
            <p>
              You are searching near {nearby.search_zip_code}. Would you like to add your current
              location as a home for travel routes, and search for theaters here?
            </p>
            <small>
              {nearby.display_name}. Device location may be approximate; you can enter your
              hotel address in Settings instead.
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
            <button type="button" onClick={dismiss}>Not now</button>
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
