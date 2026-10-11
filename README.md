# Fly or Fold Site Editor

An installable web app (PWA) for editing [forecast-log](https://github.com/FlyOrFold/forecast-log)'s
`sites.csv` with a form instead of a spreadsheet. It also opens any other CSV file.

Everything stays on the device: imported files are kept in the browser's IndexedDB and nothing is
uploaded. There is no server and no account.

## Using it

1. **Import** a CSV file (button, or drag it onto the window). The header row gives the field names.
2. Pick a row in the list. Edit it in the form and **Save**. Saving stores the change on this device
   only; changed rows get an orange dot, and the Export button counts the changes.
3. **Export** downloads the current data as a CSV with the same file name. On a phone it opens the
   share sheet, so you can save it to Files or Drive. On desktop Chrome or Edge, **Save to file**
   writes straight back to the file you imported.
4. Commit the exported `sites.csv` to forecast-log as its README describes.

Rows are listed by name; the CSV keeps its original row and column order. An unedited export is
byte-for-byte the same as the imported file (quoting follows Python's `csv` module, which
forecast-log uses).

## Field labels and validation

`js/profiles.js` holds built-in *profiles*, matched to a file by name (or by its headers, so
`sites (1).csv` still matches). A profile sets labels, help text, grouping, input type and
validators per column, and the status badges in the list. The `sites.csv` profile mirrors the rules
in `forecast_log/sites.py`: ID format, number ranges, `dir_ranges` syntax, `skip` values, URL format,
and speed and flying-window order. Blank criteria are allowed (the row is then not forecast and is
shown as **Incomplete**).

A CSV without a profile still works: labels come from the headers (`speed_min` → "Speed min") and
input types are guessed from the values.

Profiles are plain data so a later form designer can edit them and store one per file.

## Running locally

Any static file server works. With Python:

```bash
python3 -m http.server 8090
```

Then open <http://localhost:8090>. Service workers and installing need `localhost` or HTTPS.

Tests (Node 20+, no packages):

```bash
node --test tests/
```

The CSV tests round-trip the sibling checkouts `../forecast-log/sites.csv` and
`../flyorfold.github.io/sample/sites.csv` when they are there.

## Installing

- **Desktop Chrome or Edge:** the install icon in the address bar. The installed app can also be set
  to open `.csv` files.
- **iPhone or iPad (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.

Browsers may clear data for sites you have not visited in a while; installed apps are exempt, and
the app asks for persistent storage on first import. Export is the backup.

## Deploying

Static files only, served from any path (all URLs are relative). Bump `VERSION` in `sw.js` when
the list of files changes.

## License

Code is MIT (see `LICENSE`). The Fly or Fold name and logo are not licensed.
