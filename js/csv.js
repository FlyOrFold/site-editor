// CSV parsing and writing (RFC 4180). Pure: no DOM, importable in Node.
//
// Writing mirrors Python's csv module with QUOTE_MINIMAL, which is what forecast-log uses
// to write sites.csv back: a field is quoted only when it contains a comma, a quote or a
// line break. Exporting an unedited file therefore gives back the same bytes.

/** Parse CSV text into { headers, rows, lineEnding, bom }. Rows are arrays of strings. */
export function parseCSV(text) {
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const lineEnding = /\r\n/.test(text) ? "\r\n" : "\n";

  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(field); field = "";
      records.push(row); row = [];
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length) { row.push(field); records.push(row); }

  const headers = (records.shift() || []).map((h) => h.trim());
  let extraCells = 0;
  const rows = [];
  for (const r of records) {
    // forecast-log skips blank lines and rows of empty cells; so do we.
    if (!r.some((v) => v.trim() !== "")) continue;
    if (r.length > headers.length) extraCells += r.length - headers.length;
    rows.push(headers.map((_, k) => r[k] ?? ""));
  }
  return { headers, rows, lineEnding, bom, extraCells };
}

function quote(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Write headers and rows back to CSV text, ending with a line break. */
export function toCSV({ headers, rows, lineEnding = "\n", bom = false }) {
  const lines = [headers, ...rows].map((r) => r.map(quote).join(","));
  return (bom ? "﻿" : "") + lines.join(lineEnding) + lineEnding;
}
