# UI / UX design contract

This document defines durable user-facing behavior for Movie Showtimes. It intentionally does not prescribe a frontend framework or implementation library; those choices belong in `AGENTS.md`.

## Product goal

Movie Showtimes is a decision workstation for answering one question quickly: **which screening should I go to?** The interface should minimize navigation and comparison cost while keeping source evidence and configuration inspectable.

The application has three coordinated surfaces: Screenings, Movie Selection, and Settings. They should feel like views of one product, not separate dashboards.

## Screenings

The Screenings view is the primary surface. It is one dense, spreadsheet-style table rather than a grid of cards or a separate filter dashboard.

Every displayed column is both data and a control surface:

- activating the column label sorts that column;
- a distinct header control opens that column's filter menu;
- every column supports exact-value selection;
- text columns support text rules;
- numeric columns support numeric comparison rules;
- time columns support time comparison rules.

Filtering and sorting already-loaded screenings must be client-side and effectively instantaneous. Changing a table filter, sort, Saved View, or selected movie must not refetch the screening API.

The default sort is Listed start, earliest first. Unknown values remain explicit as `Unknown` and sort after known values. Numeric values use tabular numerals where practical.

### Time semantics

All time comparisons use complete datetimes, not clock-only values. A filter boundary entered as a clock time is interpreted on the screening's listed calendar date. Calculated times that cross midnight display a day offset such as `(+1d)`.

The frontend displays timing values supplied by the backend. It must not independently calculate preview-adjusted starts, end times, travel departure times, or home-arrival times.

### Evidence and detail

Externally sourced values remain linked to the most specific defensible source supplied by the backend. Unknown values are not given synthetic source links.

A screening may expose an in-context inspector for additional detail and evidence, but inspecting a row must not navigate away from the current table state or trigger another API request.

### Saved Views

Saved Views are browser-local snapshots of table sort and filter state. They do not contain application Settings or the exact Movie Selection.

Saving a view strips the Movie filter's exact selected-title set, including when the view was created while Movie Selection was active. Loading a view preserves whichever movies are currently selected. Older locally stored views that contain selected movie titles are migrated by removing that selection when read.

A non-selection Movie column rule, such as a text operator/operand, may still be part of a Saved View. Editing the table's exact Movie selection and selecting poster tiles continue to synchronize with each other independently of Saved Views.

## Movie Selection

Movie Selection is poster-first and optimized for fast inclusion/exclusion. The poster tile itself is the selection control, with a visible selected state and an equivalent accessible pressed state.

The view has local filtering for title text, selected/unselected status, minimum IMDb/Rotten Tomatoes/Metacritic ratings, and an initial-release-date range. These filters only change which poster tiles are visible; they do not mutate the Screenings table's filters or issue another screening request.

The view can sort in either direction by title, initial release date, IMDb, Rotten Tomatoes, or Metacritic. The active sort field and each movie's value for that field are shown directly under the title so the ordering can be audited without opening a detail view. Known values sort ahead of unknown values.

Initial release date is backend-supplied metadata. The current enrichment path normalizes OMDb's `Released` value to an ISO calendar date; missing or unavailable metadata remains `Unknown`. The frontend must not infer a release date from the movie title, the current screening date, or another unrelated field.

Movie selection itself is browser-local and is the source of truth for the Screenings table's exact Movie filter. Poster or metadata enrichment failure must not make a movie unselectable. A clear title fallback is required.

## Settings

Settings must visibly distinguish two persistence scopes.

### This browser

ZIP/radius and preview minutes by theater chain are browser-local. They persist in local storage and are mirrored to cookies because the backend needs them before generating the screening response.

### Shared server

Home address/geocoded location, AMC developer key, OMDb key, and AMC A-List preference are server-owned settings shared by Test and Production through persistent storage.

Secret values are write-only from the browser's perspective. The UI may show whether a key exists, accept a replacement, and provide an explicit clear action; it must never reveal the stored key.

Provider request/cache usage is informational. OMDb's published limit may be shown with app-accounting context. AMC quota percentages or reset times must only be shown when AMC actually provides rate-limit metadata.

## Responsive behavior

Desktop prioritizes maximum comparison density and can use a persistent or adjacent inspector without covering the table.

Mobile is designed intentionally rather than produced by uniformly shrinking desktop. Navigation and primary actions remain reachable, the screening table remains a real table with horizontal scrolling as needed, and the Movie column should retain orientation while scrolling when practical. Column filtering remains usable with touch-sized controls and may use a full-width sheet presentation.

Movie Selection filter controls reflow into fewer columns as the viewport narrows rather than becoming a horizontally scrolling desktop form. No mobile layout may silently drop a screening field solely to fit the viewport.

## Accessibility

Use semantic headings, navigation, forms, buttons, tables, labels, and status regions. All controls must be keyboard reachable. Sort state uses `aria-sort`; expandable filter controls expose expanded state; selectable movie posters expose their pressed state. Focus indicators must remain visible.

Do not use color as the only indication of selection, filtering, warning, or error. Motion is minimal and respects reduced-motion preferences.

## Visual language

The product should look like a focused utility: restrained color, strong typographic hierarchy, compact spacing, crisp separators, little decoration, and minimal animation. Avoid decorative dashboard cards, gratuitous gradients, oversized hero treatments, and visualizations that do not improve a decision.

## Data and loading behavior

The backend is authoritative for business logic, derived timing, models, provider matching, and data semantics. The frontend consumes typed API contracts and owns only presentation and interaction state.

Screenings are fetched once for a chosen date/location configuration and then manipulated locally. Settings changes that affect server-returned screening data may trigger an explicit refresh. External enrichment failures should surface as unknown data rather than make the whole workstation unusable.
