import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseCSV, toCSV } from "../js/csv.js";

test("parses quoted fields, doubled quotes and embedded commas and line breaks", () => {
  const { headers, rows } = parseCSV('a,b,c\n1,"x, y","say ""hi"""\n2,"two\nlines",\n');
  assert.deepEqual(headers, ["a", "b", "c"]);
  assert.deepEqual(rows, [["1", "x, y", 'say "hi"'], ["2", "two\nlines", ""]]);
});

test("handles CRLF, a BOM, a missing final newline and blank rows", () => {
  const p = parseCSV("﻿id,name\r\n1,A\r\n,\r\n\r\n2,B");
  assert.equal(p.bom, true);
  assert.equal(p.lineEnding, "\r\n");
  assert.deepEqual(p.rows, [["1", "A"], ["2", "B"]]);
  assert.equal(toCSV(p), "﻿id,name\r\n1,A\r\n2,B\r\n");
});

test("pads short rows and counts dropped extra cells", () => {
  const p = parseCSV("a,b\n1\n1,2,3\n");
  assert.deepEqual(p.rows, [["1", ""], ["1", "2"]]);
  assert.equal(p.extraCells, 1);
});

test("quotes only when needed, like Python's QUOTE_MINIMAL", () => {
  const text = toCSV({ headers: ["a", "b"], rows: [["plain", "has, comma"], ['q"uote', "line\nbreak"], [" space ", ""]] });
  assert.equal(text, 'a,b\nplain,"has, comma"\n"q""uote","line\nbreak"\n space ,\n');
});

// forecast-log writes sites.csv with Python's csv module, so an unedited round trip must
// give back the same bytes. Uses the sibling checkout when it is there.
for (const path of ["../../forecast-log/sites.csv", "../../flyorfold.github.io/sample/sites.csv"]) {
  const url = new URL(path, import.meta.url);
  test(`round-trips ${path.split("/").slice(-2).join("/")} unchanged`, { skip: !existsSync(url) }, () => {
    const text = readFileSync(url, "utf8");
    assert.equal(toCSV(parseCSV(text)), text);
  });
}
