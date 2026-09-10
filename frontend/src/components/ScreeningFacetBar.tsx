import { useMemo, useState } from "react";

import {
  activeFacetCount,
  type CheckboxSelection,
  EMPTY_SCREENING_FACETS,
  listedWindowOptions,
  type ScreeningFacets,
  textOptions,
} from "../screening-facets";
import type { Screening } from "../types";
import { CheckboxFilter } from "./CheckboxFilter";
import "./screening-facet-bar.css";

type FacetKey = keyof ScreeningFacets;

interface Props {
  facets: ScreeningFacets;
  screenings: readonly Screening[];
  onChange: (facets: ScreeningFacets) => void;
}

/** Exact-value screening filters for pages that do not own the table's column menus. */
export function ScreeningFacetBar({ facets, screenings, onChange }: Props) {
  const [openFacet, setOpenFacet] = useState<FacetKey | null>(null);
  const theaters = useMemo(() => textOptions(screenings, "theatre"), [screenings]);
  const chains = useMemo(() => textOptions(screenings, "chain"), [screenings]);
  const formats = useMemo(() => textOptions(screenings, "format"), [screenings]);
  const listedWindows = useMemo(() => listedWindowOptions(screenings), [screenings]);

  function checkboxProps(key: FacetKey) {
    return {
      selected: facets[key],
      open: openFacet === key,
      onOpenChange: (open: boolean) => setOpenFacet(open ? key : null),
      onChange: (selected: CheckboxSelection) => onChange({ ...facets, [key]: selected }),
    };
  }

  return (
    <fieldset className="facet-bar">
      <legend className="sr-only">Showing filters</legend>
      <CheckboxFilter
        label="Theater"
        options={theaters}
        searchable
        {...checkboxProps("theaters")}
      />
      <CheckboxFilter label="Chain" options={chains} searchable {...checkboxProps("chains")} />
      <CheckboxFilter label="Format" options={formats} {...checkboxProps("formats")} />
      <CheckboxFilter
        label="Listed time"
        options={listedWindows}
        {...checkboxProps("listedWindows")}
      />
      <div className="facet-bar-actions">
        <button
          type="button"
          disabled={activeFacetCount(facets) === 0}
          onClick={() => {
            setOpenFacet(null);
            onChange(EMPTY_SCREENING_FACETS);
          }}
        >
          Clear showing filters
        </button>
      </div>
    </fieldset>
  );
}
