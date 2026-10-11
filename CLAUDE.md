# CLAUDE.md

PWA that edits a CSV file as a form, built first for forecast-log's `sites.csv`. See README.md for
what it does. Sibling checkouts: `../flyorfold.github.io` (website, source of the look and the
tokens) and `../forecast-log` (owns `sites.csv` and its rules in `src/forecast_log/sites.py`).

## Rules

- **Data never leaves the device.** No network requests other than the app's own files, no
  analytics, no third-party scripts or fonts. Imported data lives in IndexedDB (`js/store.js`).
- **Round-trip fidelity.** An unedited export must equal the imported bytes: keep row and column
  order, line endings and BOM, and quote like Python's `csv` QUOTE_MINIMAL. A test checks this
  against the real `sites.csv`.
- **Validation mirrors forecast-log.** If `forecast_log/sites.py` changes its columns or rules,
  update the `sites.csv` profile in `js/profiles.js` and the tests. Never require a criteria column:
  forecast-log allows blank criteria (the row is just not forecast).
- **Profiles are plain data** (no functions) so the planned form designer can edit and store them.
  Custom logic goes in a named validator in `CHECKS` (`js/fields.js`) referenced by `check`.

## Stack

- Plain ES modules, no bundler, no packages. `js/app.js` is the only module with DOM side effects;
  `csv.js`, `fields.js` and `profiles.js` stay importable in Node.
- Tests: `node --test tests/`. Add one when changing parsing, writing, inference or validation.
- Local dev: `python3 -m http.server 8090` (also `.claude/launch.json`).
- `sw.js` is network first with a cache fallback for offline. Bump `VERSION` when files are added
  or removed, and add them to `SHELL`.
- Colours are copied from the website's `assets/css/site.css` as `light-dark()` tokens at the top of
  `css/editor.css`. Keep them in step with the site; never add a `prefers-color-scheme` block.
  Icons in `img/` are copies of the site's; regenerate them there, then copy.
- Inline SVG icons are `<symbol>`s at the top of `index.html` (16px grid, 1.8 stroke, round caps).
- Mobile first: below 820px the list and the form are separate views, routed by the URL hash
  (`#row=N`, `#new`).

## Planned (phase 2)

A form designer to set labels, help, order and validators per column, saved per CSV file
(IndexedDB, with import/export of the profile as JSON). Then the app becomes a generic CSV form
editor; the Fly or Fold branding would move to a theme.
