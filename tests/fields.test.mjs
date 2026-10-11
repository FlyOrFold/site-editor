import { test } from "node:test";
import assert from "node:assert/strict";
import { humanize, inferKind, buildForm, validate, rowStatus, fieldLink, listColumns, CHECKS } from "../js/fields.js";
import { profileFor } from "../js/profiles.js";

const HEADERS = ["id", "name", "lat", "lon", "timezone", "dir_ranges", "speed_min", "speed_max", "gust_max",
  "rain_mm_max", "fly_start", "fly_end", "min_hours", "skip", "notes", "pge_id", "info_url"];
const GOOD = ["lake-erie", "Lake Erie", "41.48", "-81.74", "America/New_York", "340-20", "5", "15", "18",
  "0.1", "10", "18", "2", "", "", "9908", "https://example.org/"];

const sites = profileFor("sites.csv");
const form = buildForm(HEADERS, [GOOD], sites);
const fieldsOf = (groups) => groups.flatMap((g) => g.fields);
const errorsFor = (changes, rows = [GOOD], index = 0) => {
  const values = [...GOOD];
  for (const [h, v] of Object.entries(changes)) values[HEADERS.indexOf(h)] = v;
  const errs = validate(values, form, { rows, index, headers: HEADERS });
  return Object.fromEntries(Object.entries(errs).map(([c, m]) => [HEADERS[c], m]));
};

test("humanize makes readable labels from headers", () => {
  assert.equal(humanize("speed_min"), "Speed min");
  assert.equal(humanize("info_url"), "Info URL");
  assert.equal(humanize("firstName"), "First name");
  assert.equal(humanize(""), "(no name)");
});

test("inferKind guesses from values", () => {
  assert.equal(inferKind(["1", "", "22"]), "integer");
  assert.equal(inferKind(["1.5", "-2"]), "number");
  assert.equal(inferKind(["https://a.b", ""]), "url");
  assert.equal(inferKind(["x".repeat(81)]), "textarea");
  assert.equal(inferKind(["", ""]), "text");
});

test("the sites profile matches by name or by headers", () => {
  assert.equal(profileFor("Sites.CSV"), sites);
  assert.equal(profileFor("sites (1).csv", HEADERS), sites);
  assert.equal(profileFor("other.csv", ["a", "b"]), null);
});

test("buildForm follows profile groups and puts unknown columns in Other", () => {
  const groups = buildForm([...HEADERS, "extra"], [[...GOOD, "7"]], sites);
  assert.deepEqual(groups.map((g) => g.title), ["Site", "Launch", "Wind", "Flying day", "Notes and links", "Other"]);
  assert.deepEqual(groups[0].fields.map((f) => f.header), ["name", "id", "skip"]);
  const extra = groups.at(-1).fields[0];
  assert.equal(extra.label, "Extra");
  assert.equal(extra.kind, "integer");
  assert.equal(fieldsOf(groups).length, HEADERS.length + 1);
});

test("a file with no profile gets one untitled group in column order", () => {
  const groups = buildForm(["a", "b"], [["1", "x"]], null);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "");
  assert.deepEqual(groups[0].fields.map((f) => f.header), ["a", "b"]);
});

test("a valid sites row has no errors; blank criteria are allowed", () => {
  assert.deepEqual(errorsFor({}), {});
  assert.deepEqual(errorsFor({ dir_ranges: "", speed_min: "", timezone: "", pge_id: "", info_url: "" }), {});
});

test("sites validation matches forecast-log's rules", () => {
  assert.match(errorsFor({ id: "" }).id, /required/);
  assert.match(errorsFor({ id: "Lake Erie" }).id, /lowercase/);
  assert.match(errorsFor({ lat: "91" }).lat, /at most 90/);
  assert.match(errorsFor({ lon: "abc" }).lon, /number/);
  assert.match(errorsFor({ fly_start: "10.5" }).fly_start, /whole/);
  assert.match(errorsFor({ fly_start: "18" }).fly_start, /less than Window ends/);
  assert.match(errorsFor({ speed_min: "20" }).speed_min, /not be more than Max wind speed/);
  assert.match(errorsFor({ skip: "maybe" }).skip, /one of/);
  assert.deepEqual(errorsFor({ skip: "YES" }), {});
  assert.match(errorsFor({ info_url: "example.org" }).info_url, /http/);
  assert.match(errorsFor({ pge_id: "12a" }).pge_id, /number/);
  assert.match(errorsFor({ timezone: "Mars/Olympus" }).timezone, /time zone/);
});

test("unique IDs are checked against other rows only", () => {
  const other = [...GOOD];
  assert.match(errorsFor({}, [GOOD, other], 0).id, /already uses/);
  assert.deepEqual(errorsFor({}, [GOOD], 0), {});
  assert.match(errorsFor({}, [GOOD], -1).id, /already uses/);
});

test("dirRanges accepts wrap-through-north and several ranges", () => {
  assert.equal(CHECKS.dirRanges("340-20"), "");
  assert.equal(CHECKS.dirRanges("255-285; 300-320"), "");
  assert.equal(CHECKS.dirRanges("255 - 285"), "");
  assert.match(CHECKS.dirRanges("270"), /look like/);
  assert.match(CHECKS.dirRanges("300-400"), /outside/);
  assert.match(CHECKS.dirRanges(";"), /at least one/);
});

test("rowStatus: skipped, then incomplete, then forecast daily", () => {
  const s = (changes) => {
    const r = [...GOOD];
    for (const [h, v] of Object.entries(changes)) r[HEADERS.indexOf(h)] = v;
    return rowStatus(r, HEADERS, sites).label;
  };
  assert.equal(s({}), "Forecast daily");
  assert.equal(s({ gust_max: "" }), "Incomplete");
  assert.equal(s({ skip: "Yes", gust_max: "" }), "Skipped");
  assert.equal(s({ timezone: "" }), "Forecast daily");
  assert.equal(rowStatus(GOOD, HEADERS, null), null);
});

test("fieldLink fills templates and passes through URLs", () => {
  const f = fieldsOf(form);
  const pge = f.find((x) => x.header === "pge_id");
  const info = f.find((x) => x.header === "info_url");
  assert.equal(fieldLink(pge, " 9908 "), "https://www.paraglidingearth.com/?site=9908");
  assert.equal(fieldLink(pge, ""), "");
  assert.equal(fieldLink(info, "https://a.b/c"), "https://a.b/c");
  assert.equal(fieldLink(info, "javascript:alert(1)"), "");
});

test("listColumns picks title and subtitle", () => {
  assert.deepEqual(listColumns(HEADERS, sites), { title: 1, sub: 0 });
  assert.deepEqual(listColumns(["Title", "year"], null), { title: 0, sub: 1 });
  assert.deepEqual(listColumns(["x"], null), { title: 0, sub: -1 });
});
