// Turns CSV headers plus an optional profile (profiles.js) into form fields, and validates
// a record against them. Pure: no DOM, importable in Node.

/** "speed_min" -> "Speed min", "infoURL" -> "Info URL". Used when no profile gives a label. */
export function humanize(header) {
  const words = String(header)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "(no name)";
  return words
    .map((w, i) => {
      if (/^(id|url|uri|api)$/i.test(w) || (w.length > 1 && w === w.toUpperCase())) return w.toUpperCase();
      return i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase();
    })
    .join(" ");
}

const isNumber = (s) => s.trim() !== "" && Number.isFinite(Number(s.trim()));

/** Guess an input kind from a column's values, for columns no profile describes. */
export function inferKind(values) {
  const filled = values.filter((v) => v.trim() !== "");
  if (filled.some((v) => v.length > 80 || /[\r\n]/.test(v))) return "textarea";
  if (!filled.length) return "text";
  if (filled.every(isNumber)) return filled.every((v) => /^-?\d+$/.test(v.trim())) ? "integer" : "number";
  if (filled.every((v) => /^https?:\/\//i.test(v.trim()))) return "url";
  return "text";
}

/**
 * Form fields for a file: [{ title, fields: [field] }]. Each field is
 * { col, header, label, kind, ...profile settings }. `col` is the column index, so files with
 * duplicate or blank header names still work.
 */
export function buildForm(headers, rows, profile) {
  const settings = profile?.fields || {};
  const make = (col) => {
    const header = headers[col];
    const s = settings[header] || {};
    return {
      ...s,
      col,
      header,
      label: s.label || humanize(header),
      kind: s.kind || inferKind(rows.map((r) => r[col] ?? "")),
    };
  };

  const used = new Set();
  const groups = [];
  for (const g of profile?.groups || []) {
    const cols = g.fields.map((h) => headers.indexOf(h)).filter((c) => c >= 0 && !used.has(c));
    cols.forEach((c) => used.add(c));
    if (cols.length) groups.push({ title: g.title, fields: cols.map(make) });
  }
  const rest = headers.map((_, c) => c).filter((c) => !used.has(c));
  if (rest.length) groups.push({ title: groups.length ? "Other" : "", fields: rest.map(make) });
  return groups;
}

/** Named validators a profile can ask for with `check`. Each returns an error message or "". */
export const CHECKS = {
  // forecast_log/sites.py parse_dir_ranges: "255-285" or "340-20; 90-110", each end 0–360.
  dirRanges(v) {
    const parts = v.split(";").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return "Enter at least one range, like 255-285.";
    for (const p of parts) {
      const m = p.match(/^(\S+?)\s*-\s*(\S+)$/);
      if (!m || !isNumber(m[1]) || !isNumber(m[2])) return `"${p}" should look like 255-285.`;
      for (const d of [Number(m[1]), Number(m[2])]) {
        if (d < 0 || d > 360) return `${d} is outside 0–360 in "${p}".`;
      }
    }
    return "";
  },
  timezone(v) {
    if (typeof Intl === "undefined" || !Intl.supportedValuesOf) return "";
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.trim() });
      return "";
    } catch {
      return `"${v}" is not a known time zone, such as America/New_York.`;
    }
  },
};

/**
 * Errors for one record: { [col]: message }. `values` is the record being edited (array by
 * column), `rows` all rows in the file and `index` this record's position (-1 for a new one).
 */
export function validate(values, groups, { rows = [], index = -1, headers = [] } = {}) {
  const errors = {};
  const byHeader = (h) => {
    const c = headers.indexOf(h);
    return c >= 0 ? (values[c] ?? "").trim() : "";
  };
  for (const f of groups.flatMap((g) => g.fields)) {
    const raw = values[f.col] ?? "";
    const v = raw.trim();
    const err = (m) => { errors[f.col] = m; };

    if (!v) {
      if (f.required) err(`${f.label} is required.`);
      continue;
    }
    if (f.kind === "number" || f.kind === "integer") {
      if (!isNumber(v)) { err("Enter a number."); continue; }
      const n = Number(v);
      if (f.kind === "integer" && !Number.isInteger(n)) { err("Enter a whole number."); continue; }
      if (f.min != null && n < f.min) { err(`Must be at least ${f.min}.`); continue; }
      if (f.max != null && n > f.max) { err(`Must be at most ${f.max}.`); continue; }
      const other = f.atMost || f.below;
      const o = other ? byHeader(other) : "";
      if (o && isNumber(o)) {
        const label = groups.flatMap((g) => g.fields).find((x) => x.header === other)?.label || other;
        if (f.atMost && n > Number(o)) { err(`Must not be more than ${label} (${o}).`); continue; }
        if (f.below && n >= Number(o)) { err(`Must be less than ${label} (${o}).`); continue; }
      }
    }
    if (f.kind === "url" && !/^https?:\/\/\S+$/i.test(v)) { err("Must start with http:// or https://"); continue; }
    if (f.oneOf && !f.oneOf.some((o) => o.toLowerCase() === v.toLowerCase())) {
      err(`Use one of: ${f.oneOf.filter(Boolean).join(", ")}.`); continue;
    }
    if (f.pattern && !new RegExp(f.pattern).test(v)) { err(f.patternMessage || "Not in the expected format."); continue; }
    if (f.check && CHECKS[f.check]) {
      const m = CHECKS[f.check](v);
      if (m) { err(m); continue; }
    }
    if (f.unique && rows.some((r, i) => i !== index && (r[f.col] ?? "").trim() === v)) {
      err(`Another row already uses "${v}".`);
    }
  }
  return errors;
}

/** The status badge for a row from the profile's rules, or null. */
export function rowStatus(row, headers, profile) {
  const cell = (h) => {
    const c = headers.indexOf(h);
    return c >= 0 ? (row[c] ?? "").trim() : "";
  };
  for (const rule of profile?.status || []) {
    const w = rule.when;
    if (!w) return rule;
    if (w.field && w.in?.some((x) => x.toLowerCase() === cell(w.field).toLowerCase())) return rule;
    if (w.blankAny?.some((h) => headers.includes(h) && !cell(h))) return rule;
  }
  return null;
}

/** Fill a field's link template, or return the value itself for a URL field. */
export function fieldLink(field, value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (field.link) return field.link.replace("{value}", encodeURIComponent(v));
  if (field.kind === "url" && /^https?:\/\//i.test(v)) return v;
  return "";
}

/** Which column titles a row in the list, and which gives its subtitle. */
export function listColumns(headers, profile) {
  const find = (names) => names.map((n) => headers.indexOf(n)).find((c) => c >= 0) ?? -1;
  let title = profile?.titleField ? headers.indexOf(profile.titleField) : -1;
  if (title < 0) title = find(["name", "title", "Name", "Title", "label", "Label"]);
  if (title < 0) title = 0;
  let sub = profile?.subtitleField ? headers.indexOf(profile.subtitleField) : -1;
  if (sub < 0) sub = find(["id", "ID", "Id", "key"]);
  if (sub === title) sub = -1;
  if (sub < 0 && headers.length > 1) sub = title === 0 ? 1 : 0;
  return { title, sub };
}
