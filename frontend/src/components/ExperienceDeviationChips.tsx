import type { ExperienceDeviation } from "../types";
import "./experience-deviation-chips.css";

export function ExperienceDeviationChips({
  deviations,
}: {
  deviations?: readonly ExperienceDeviation[];
}) {
  if (!deviations?.length) return null;

  return (
    <span className="experience-deviations" aria-label="Experience differences">
      {deviations.map((deviation) => {
        const positive = deviation.score_delta > 0;
        return (
          <span
            key={deviation.id}
            className={`experience-deviation ${deviation.polarity}`}
            aria-label={`${deviation.label}, ${positive ? "plus" : "minus"} one want point`}
          >
            <span className="experience-deviation-sign" aria-hidden="true">
              {positive ? "+" : "−"}
            </span>
            {deviation.label}
          </span>
        );
      })}
    </span>
  );
}
