import { browserDate } from "../show-date";
import { useAppStore } from "../store";
import "./show-date-control.css";

export function ShowDateControl() {
  const selectedDate = useAppStore((state) => state.selectedDate);
  const setSelectedDate = useAppStore((state) => state.setSelectedDate);
  const today = browserDate();

  return (
    <div className="show-date-control">
      <label>
        <span>Date</span>
        <input
          aria-label="Show date"
          type="date"
          min={today}
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
        />
      </label>
      {selectedDate !== today ? (
        <button type="button" onClick={() => setSelectedDate(today)}>
          Today
        </button>
      ) : null}
    </div>
  );
}
