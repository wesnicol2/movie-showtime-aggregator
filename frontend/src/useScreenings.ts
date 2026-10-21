import { useEffect } from "react";

import { fetchScreenings } from "./api";
import { useAppStore } from "./store";

// Show a saved date immediately. Revalidate in the background on entry, on
// returning to the tab, and while the page is open; the request layer enforces
// a ten-minute TTL so this does not hammer providers.
export function useScreenings(): void {
  const selectedDate = useAppStore((state) => state.selectedDate);
  const screeningsRevision = useAppStore((state) => state.screeningsRevision);
  const setLoading = useAppStore((state) => state.setLoading);
  const setResponse = useAppStore((state) => state.setResponse);
  const setError = useAppStore((state) => state.setError);

  useEffect(() => {
    let active = true;
    if (!useAppStore.getState().response) setLoading();

    function revalidate(): void {
      void fetchScreenings(selectedDate)
        .then((response) => {
          if (!active) return;
          const current = useAppStore.getState();
          if (current.selectedDate !== selectedDate || current.response === response) return;
          setResponse(response);
        })
        .catch((error: unknown) => {
          if (!active) return;
          const current = useAppStore.getState();
          // On a transient upstream failure, retain a previously cached page.
          if (current.selectedDate === selectedDate && !current.response)
            setError(error instanceof Error ? error.message : "Unable to load screenings");
        });
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") revalidate();
    }

    revalidate();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidate();
    }, 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedDate, screeningsRevision, setLoading, setResponse, setError]);
}
