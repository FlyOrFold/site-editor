// Built-in form profiles, matched to a CSV by file name.
//
// A profile is plain data (no functions) so the phase-2 form designer can edit it and store
// a per-file copy. Columns a profile does not mention still appear, in an "Other" group, with
// settings guessed from their values (see fields.js). Field keys are CSV header names.
//
// Field settings:
//   label, help        text shown on the form
//   kind               text | textarea | number | integer | url | select | timezone
//   options            for select: [{ value, label }]; the current value is kept even if not listed
//   placeholder        hint shown in an empty input
//   required, unique   value must be filled / differ from every other row
//   min, max           numeric bounds (number and integer kinds)
//   atMost, below      another column this number must be <= / < (only checked when both are filled)
//   pattern, patternMessage   regular expression the value must match, and the message if it does not
//   oneOf              allowed values, compared case-insensitively (blank is always allowed unless required)
//   check              named custom validator from fields.js CHECKS
//   link               URL template opened by the field's link button; {value} is the field value
//   changeWarning      shown while an existing row's value is being changed from its saved value
//
// Profile settings:
//   titleField, subtitleField   columns shown in the list
//   groups             [{ title, fields: [header, …] }] in form order
//   status             list badges; the first rule whose `when` matches wins, a rule with no `when` is the default.
//                      when: { field, in: [...] } (case-insensitive) or { blankAny: [header, …] }

// Columns a sites.csv row needs before forecast-log scores it (mirrors forecast_log/sites.py REQUIRED).
const CRITERIA = ["lat", "lon", "dir_ranges", "speed_min", "speed_max", "gust_max",
  "rain_mm_max", "fly_start", "fly_end", "min_hours"];

// Values forecast-log accepts in `skip` (forecast_log/sites.py _bool).
const SKIP_YES = ["yes", "y", "true", "1", "x"];
const SKIP_NO = ["no", "n", "false", "0"];

export const PROFILES = [
  {
    match: "sites.csv",
    title: "Sites",
    itemName: "site",
    titleField: "name",
    subtitleField: "id",
    groups: [
      { title: "Site", fields: ["name", "id", "skip"] },
      { title: "Launch", fields: ["lat", "lon", "timezone"] },
      { title: "Wind", fields: ["dir_ranges", "speed_min", "speed_max", "gust_max"] },
      { title: "Flying day", fields: ["rain_mm_max", "fly_start", "fly_end", "min_hours"] },
      { title: "Notes and links", fields: ["notes", "pge_id", "info_url"] },
    ],
    status: [
      { label: "Skipped", tone: "off", when: { field: "skip", in: SKIP_YES } },
      { label: "Incomplete", tone: "warn", when: { blankAny: CRITERIA } },
      { label: "Forecast daily", tone: "ok" },
    ],
    fields: {
      id: {
        label: "Site ID", required: true, unique: true,
        pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
        patternMessage: "Use lowercase letters, digits and single hyphens, like lake-erie-cleveland.",
        help: "Stable ID used in the forecast data.",
        changeWarning: "Renaming an ID splits this site's forecast history. Only rename it if no data has been logged yet.",
      },
      name: { label: "Name", required: true, help: "Display name on the website." },
      skip: {
        label: "Forecast", kind: "select",
        options: [{ value: "", label: "Forecast daily" }, { value: "yes", label: "Skip: keep the row, stop forecasting" }],
        oneOf: [...SKIP_YES, ...SKIP_NO],
      },
      lat: { label: "Latitude", kind: "number", min: -90, max: 90, placeholder: "41.4873", help: "Launch coordinates, decimal degrees." },
      lon: { label: "Longitude", kind: "number", min: -180, max: 180, placeholder: "-81.7477" },
      timezone: {
        label: "Time zone", kind: "timezone", check: "timezone",
        help: "Leave blank and forecast-log looks it up from the coordinates. Use the launch's zone, not the nearest city's.",
      },
      dir_ranges: {
        label: "Wind directions", check: "dirRanges", placeholder: "255-285 or 340-20; 90-110",
        help: "Degrees the wind blows from (N 0, E 90, S 180, W 270). A range may wrap through north; separate ranges with ;",
      },
      speed_min: { label: "Min wind speed", kind: "number", min: 0, atMost: "speed_max", help: "mph, inclusive." },
      speed_max: { label: "Max wind speed", kind: "number", min: 0, help: "mph, inclusive." },
      gust_max: { label: "Max gust", kind: "number", min: 0, help: "mph." },
      rain_mm_max: { label: "Max rain", kind: "number", min: 0, help: "mm per hour." },
      fly_start: { label: "Window starts", kind: "integer", min: 0, max: 23, below: "fly_end", help: "Site-local hour, 0–23." },
      fly_end: { label: "Window ends", kind: "integer", min: 1, max: 24, help: "Exclusive: 10 to 18 means 10:00 through 17:59." },
      min_hours: { label: "Hours needed", kind: "integer", min: 1, max: 24, help: "Consecutive qualifying hours for the day to count as flyable." },
      notes: {
        label: "Notes", kind: "textarea",
        help: "Source of each limit and whether it is verified, plus access requirements (club membership, waiver, escort).",
      },
      pge_id: {
        label: "Paragliding Earth ID", kind: "integer", min: 1,
        link: "https://www.paraglidingearth.com/?site={value}",
        help: "Optional site number from paraglidingearth.com.",
      },
      info_url: { label: "Site info link", kind: "url", help: "Optional, such as the managing club's site page." },
    },
  },
];

/**
 * The built-in profile for a file, or null. Matches the file name, or failing that a file
 * whose headers include every column the profile defines (so "sites (1).csv" still matches).
 */
export function profileFor(fileName, headers = []) {
  const name = String(fileName || "").toLowerCase();
  return PROFILES.find((p) => p.match.toLowerCase() === name)
    || PROFILES.find((p) => Object.keys(p.fields).every((h) => headers.includes(h)))
    || null;
}
