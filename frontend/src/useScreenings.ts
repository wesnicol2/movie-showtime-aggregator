import { useEffect } from "react";

import { fetchScreenings } from "./api";
import { useAppStore } from "./store";

export function useScreenings(): void {
  const status = useAppStore((state) => state.status);
  const selectedDate = useAppStore((state) => state.selectedDate);
  const setLoading = useAppStore((state) => state.setLoading);
  const setResponse = useAppStore((state) => state.setResponse);
  const setError = useAppStore((state) => state.setError);

  useEffect(() => {
    if (status !== "idle") return;
    setLoading();
    void fetchScreenings(selectedDate)
      .then(setResponse)
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Unable to load screenings");
      });
  }, [selectedDate, setError, setLoading, setResponse, status]);
}
