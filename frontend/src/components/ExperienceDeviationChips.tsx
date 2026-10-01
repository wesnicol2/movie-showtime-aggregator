import type { ExperienceDeviation } from "../types";
import "./experience-deviation-chips.css";

export function ExperienceDeviationChips({
  deviations,
}: {
  deviations?: readonly ExperienceDeviation[];
}) {
  if (!deviations?.length) return null;

  return (
    <span className="experience-deviations">
      {deviations.map((deviation) => {
        const positive = deviation.score_delta > 0;
        return (
          <span key={deviation.id} className={`experience-deviation ${deviation.polarity}`}>
            <span className="experience-deviation-sign">{positive ? "+" : "−"}</span>
            {deviation.label}
          </span>
        );
      })}
    </span>
  );
}
