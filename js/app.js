// Site Editor: list of rows on the left, a form for the chosen row on the right (one at a
// time on phones). The only module with DOM side effects; csv.js, fields.js and profiles.js
// stay pure so Node can test them.
//
// Routing is the URL hash: #row=N (N is the row's position in the file) or #new.

import { parseCSV, toCSV } from "./csv.js";
import { buildForm, validate, rowStatus, fieldLink, listColumns } from "./fields.js";
import { profileFor } from "./profiles.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const canPickFiles = "showOpenFilePicker" in window;

const state = {
  file: null,      // the store record for the open file
  profile: null,
  groups: [],
  cols: { title: 0, sub: -1 },
  index: null,     // row being edited: a number, -1 for a new row, null for none
  draft: null,     // values in the form
  base: null,      // values when the form opened, to detect changes
  showErrors: false,
  query: "",
};

// ---------------------------------------------------------------------------
// Small helpers

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...children.flat().filter((c) => c != null && c !== false));
  return n;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

let toastTimer;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function confirmDialog({ title, text, ok = "OK", danger = false }) {
  const d = $("confirm");
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = ok;
  $("confirm-ok").classList.toggle("danger-fill", danger);
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
}

const isDirty = () => state.draft && state.draft.some((v, i) => v !== state.base[i]);
const itemName = () => state.profile?.itemName || "row";
const changeCount = (f) => (f.marks || []).filter(Boolean).length + (f.deleted || 0);

// ---------------------------------------------------------------------------
// Files

async function openFile(file) {
  state.file = file;
  state.profile = profileFor(file.name, file.headers);
  state.cols = listColumns(file.headers, state.profile);
  refreshForm();
  await store.setMeta("lastFile", file.name);
  $("search").value = state.query = "";
  $("new-label").textContent = `New ${itemName()}`;
  await renderFileSwitch();
  renderHeader();
  renderList();
}

/** Rebuild the form layout; inferred field kinds depend on the current values. */
function refreshForm() {
  state.groups = buildForm(state.file.headers, state.file.rows, state.profile);
}

async function saveFile() {
  state.file.savedAt = Date.now();
  await store.putFile(state.file);
  renderHeader();
}

async function importText(name, text, handle) {
  const parsed = parseCSV(text);
  if (!parsed.headers.length || parsed.headers.every((h) => !h)) {
    toast(`${name} has no header row.`);
    return;
  }
  const existing = await store.getFile(name);
  if (existing && changeCount(existing)) {
    const ok = await confirmDialog({
      title: `Replace ${name}?`,
      text: `The copy on this device has ${changeCount(existing)} change(s) that have not been exported. Importing replaces them.`,
      ok: "Replace", danger: true,
    });
    if (!ok) return;
  }
  const file = {
    name,
    headers: parsed.headers,
    rows: parsed.rows,
    marks: [],
    deleted: 0,
    lineEnding: parsed.lineEnding,
    bom: parsed.bom,
    importedAt: Date.now(),
    savedAt: Date.now(),
    exportedAt: null,
  };
  await store.putFile(file);
  if (handle) await store.putHandle(name, handle); else await store.clearHandle(name);
  store.persist();
  await leaveForm(true);
  await openFile(file);
  showView();
  const extra = parsed.extraCells ? ` ${parsed.extraCells} cell(s) beyond the header columns were dropped.` : "";
  toast(`Imported ${parsed.rows.length} ${parsed.rows.length === 1 ? "row" : "rows"} from ${name}.${extra}`);
}

async function pickAndImport() {
  if (isDirty() && !(await discardOk())) return;
  if (canPickFiles) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }],
      });
      const f = await handle.getFile();
      await importText(f.name, await f.text(), handle);
    } catch (e) {
      if (e.name !== "AbortError") toast(`Could not open the file: ${e.message}`);
    }
    return;
  }
  $("file-input").value = "";
  $("file-input").click();
}

function csvText() {
  return toCSV(state.file);
}

async function markExported() {
  state.file.marks = [];
  state.file.deleted = 0;
  state.file.exportedAt = Date.now();
  await saveFile();
  renderList();
}

async function exportFile() {
  if (!state.file) return;
  if (isDirty() && !(await confirmDialog({
    title: "Export without the open form?",
    text: `The ${itemName()} you are editing has changes you have not saved. They will not be in the export.`,
    ok: "Export anyway",
  }))) return;
  const name = state.file.name;
  const blob = new Blob([csvText()], { type: "text/csv;charset=utf-8" });
  // Phones: the share sheet saves to Files or Drive, or sends the file on. Desktop: download.
  const shareFile = new File([blob], name, { type: "text/csv" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [shareFile] })) {
    try {
      await navigator.share({ files: [shareFile], title: name });
      await markExported();
      toast(`Exported ${name}.`);
    } catch (e) {
      if (e.name !== "AbortError") toast(`Could not share the file: ${e.message}`);
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  await markExported();
  toast(`Downloaded ${name}.`);
}

async function saveToHandle() {
  const handle = await store.getHandle(state.file.name);
  if (!handle) return;
  try {
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted"
      && (await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
      toast("Permission to write the file was not given.");
      return;
    }
    const w = await handle.createWritable();
    await w.write(csvText());
    await w.close();
    await markExported();
    toast(`Saved ${state.file.name}.`);
  } catch (e) {
    toast(`Could not save the file: ${e.message}`);
  }
}

async function removeFile() {
  const f = state.file;
  const n = changeCount(f);
  const ok = await confirmDialog({
    title: `Remove ${f.name} from this device?`,
    text: n
      ? `It has ${n} change(s) that have not been exported. They will be lost. The original file is not touched.`
      : "The copy stored in this app is deleted. The original file is not touched.",
    ok: "Remove", danger: true,
  });
  if (!ok) return;
  await store.deleteFile(f.name);
  state.file = null;
  state.index = state.draft = state.base = null;
  history.replaceState(null, "", location.pathname);
  const [next] = await store.listFiles();
  if (next) await openFile(next);
  await renderFileSwitch();
  showView();
}

// ---------------------------------------------------------------------------
// Header and file switcher

function renderHeader() {
  const f = state.file;
  $("export-btn").disabled = !f;
  const n = f ? changeCount(f) : 0;
  $("change-count").hidden = !n;
  $("change-count").textContent = n;
  $("export-btn").title = n
    ? `Download the current data as CSV (${n} change${n === 1 ? "" : "s"} since the last export)`
    : "Download the current data as CSV";
  $("file-info").textContent = f ? `${f.name} · ${f.rows.length} ${f.rows.length === 1 ? "row" : "rows"}` : "";
  if (f && canPickFiles) store.getHandle(f.name).then((h) => { $("save-file-btn").hidden = !h; });
  else $("save-file-btn").hidden = true;
}

async function renderFileSwitch() {
  const files = await store.listFiles();
  const sel = $("file-select");
  sel.replaceChildren(...files.map((f) => el("option", { value: f.name, selected: f.name === state.file?.name }, f.name)));
  sel.closest(".file-switch").hidden = files.length < 2;
}

// ---------------------------------------------------------------------------
// List

function rowLabel(row) {
  const t = (row[state.cols.title] ?? "").trim();
  return t || `(no ${state.file.headers[state.cols.title] || "name"})`;
}

function renderList() {
  const f = state.file;
  const q = state.query.trim().toLowerCase();
  const items = f.rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => !q || row.some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => rowLabel(a.row).localeCompare(rowLabel(b.row), undefined, { sensitivity: "base", numeric: true }));

  const ul = $("rows");
  ul.replaceChildren(...items.map(({ row, i }) => {
    const status = rowStatus(row, f.headers, state.profile);
    const mark = f.marks?.[i];
    return el("li", {},
      el("button", {
        class: "row-btn", type: "button", "aria-current": state.index === i ? "true" : null,
        onclick: () => go(`#row=${i}`),
      },
      el("span", { class: "row-title" },
        mark ? el("span", { class: "changed-dot", title: mark === "new" ? "New since export" : "Changed since export" }) : null,
        mark ? el("span", { class: "visually-hidden" }, mark === "new" ? "New: " : "Changed: ") : null,
        rowLabel(row)),
      state.cols.sub >= 0 ? el("span", { class: "row-sub" }, row[state.cols.sub] || " ") : null,
      status ? el("span", { class: `badge ${status.tone || "off"}` }, status.label) : null));
  }));
  if (!items.length) {
    ul.append(el("li", { class: "empty" }, q ? `Nothing matches “${state.query}”.` : `No ${itemName()}s yet.`));
  }
  const total = f.rows.length;
  $("list-count").textContent = q ? `${items.length} of ${total}` : `${total} ${total === 1 ? itemName() : itemName() + "s"}`;
}

// ---------------------------------------------------------------------------
// Form

function openForm(index, values) {
  state.index = index;
  // A new row starts from `values` (a duplicate) or blank; Revert goes back to that start.
  state.base = index >= 0 ? [...state.file.rows[index]] : values ? [...values] : state.file.headers.map(() => "");
  state.draft = [...state.base];
  state.showErrors = false;
  renderForm();
  renderList();
}

function renderForm() {
  const { file, groups, draft, index } = state;
  const errors = validate(draft, groups, { rows: file.rows, index, headers: file.headers });

  $("record-title").textContent = index >= 0 ? rowLabel(draft) : `New ${itemName()}`;
  $("record-sub").textContent = state.cols.sub >= 0 ? draft[state.cols.sub] || "" : "";
  const status = index >= 0 ? rowStatus(draft, file.headers, state.profile) : null;
  $("record-status").replaceChildren(status ? el("span", { class: `badge ${status.tone || "off"}` }, status.label) : "");

  const box = $("record-fields");
  const focused = document.activeElement?.dataset?.col;
  box.replaceChildren(...groups.map((g) => el("fieldset", { class: "group" },
    g.title ? el("legend", {}, g.title) : null,
    el("div", { class: "fields" }, g.fields.map((f) => renderField(f, errors[f.col]))))));
  if (focused != null) box.querySelector(`[data-col="${focused}"]`)?.focus();

  $("delete-btn").hidden = $("duplicate-btn").hidden = index < 0;
  updateButtons();
}

function updateButtons() {
  const dirty = isDirty();
  $("save-btn").disabled = !dirty && state.index >= 0;
  $("revert-btn").disabled = !dirty;
}

function renderField(f, error) {
  const id = `f${f.col}`;
  const value = state.draft[f.col] ?? "";
  const changed = value !== state.base[f.col];
  const showErr = error && (state.showErrors || touched.has(f.col));
  const describedBy = [`${id}-help`, showErr && `${id}-err`].filter(Boolean).join(" ");
  const common = {
    id, name: f.header, "data-col": f.col, "aria-describedby": describedBy,
    "aria-invalid": showErr ? "true" : null, "aria-required": f.required ? "true" : null,
    oninput: (e) => onInput(f, e.target.value),
    onchange: (e) => onInput(f, e.target.value, true),
    onblur: () => { touched.add(f.col); renderFieldErrors(); },
  };

  let input;
  if (f.kind === "textarea") {
    input = el("textarea", { ...common, rows: Math.min(10, Math.max(3, Math.ceil(value.length / 70))) });
    input.value = value;
  } else if (f.kind === "select") {
    const opts = [...(f.options || [])];
    if (!opts.some((o) => o.value === value)) opts.push({ value, label: value });
    input = el("select", common, opts.map((o) => el("option", { value: o.value, selected: o.value === value }, o.label)));
  } else {
    const numeric = f.kind === "number" || f.kind === "integer";
    // iOS number pads have no minus key, so only use one when the value can't be negative.
    const pad = numeric && f.min != null && f.min >= 0 ? (f.kind === "integer" ? "numeric" : "decimal") : null;
    input = el("input", {
      ...common,
      type: f.kind === "url" ? "url" : "text",
      inputmode: f.kind === "url" ? "url" : pad,
      list: f.kind === "timezone" ? "tz-list" : null,
      placeholder: f.placeholder || null,
      autocomplete: "off",
      spellcheck: f.kind === "text" ? null : "false",
    });
    input.value = value;
  }

  const href = fieldLink(f, value);
  const link = f.link || f.kind === "url"
    ? el("a", {
      class: "icon-btn", href: href || null, target: "_blank", rel: "noopener",
      "aria-label": `Open ${f.label} in a new tab`, title: "Open in a new tab",
      "aria-disabled": href ? null : "true", tabindex: href ? null : "-1",
      style: href ? null : "opacity:.4;pointer-events:none",
    }, icon("ext"))
    : null;

  const warn = f.changeWarning && state.index >= 0 && changed ? el("p", { class: "warning" }, f.changeWarning) : null;
  return el("div", { class: `field${f.kind === "textarea" ? " wide" : ""}${changed ? " changed" : ""}`, "data-field": f.col },
    el("label", { class: "field-label", for: id },
      f.label, f.required ? el("span", { class: "req", "aria-hidden": "true" }, "*") : null,
      f.label !== f.header ? el("span", { class: "col" }, f.header) : null),
    el("div", { class: "control" }, input, link),
    el("p", { class: "help", id: `${id}-help`, hidden: !f.help }, f.help || ""),
    el("p", { class: "error", id: `${id}-err`, hidden: !showErr }, showErr ? error : ""),
    warn);
}

const touched = new Set();

function onInput(f, value, commit = false) {
  state.draft[f.col] = value;
  if (commit) touched.add(f.col);
  // Cheap updates while typing; links, titles and warnings follow the value.
  const box = document.querySelector(`[data-field="${f.col}"]`);
  box?.classList.toggle("changed", value !== state.base[f.col]);
  const a = box?.querySelector("a.icon-btn");
  if (a) {
    const href = fieldLink(f, value);
    if (href) { a.href = href; a.removeAttribute("aria-disabled"); a.removeAttribute("tabindex"); a.style.cssText = ""; }
    else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); a.tabIndex = -1; a.style.cssText = "opacity:.4;pointer-events:none"; }
  }
  if (f.changeWarning && state.index >= 0) {
    const has = box.querySelector(".warning");
    const want = value !== state.base[f.col];
    if (want && !has) box.append(el("p", { class: "warning" }, f.changeWarning));
    if (!want && has) has.remove();
  }
  if (f.col === state.cols.title && state.index >= 0) $("record-title").textContent = rowLabel(state.draft);
  if (f.col === state.cols.sub) $("record-sub").textContent = value;
  renderFieldErrors();
  updateButtons();
}

/** Update error text and aria-invalid without rebuilding inputs (keeps focus and cursor). */
function renderFieldErrors() {
  const { file, groups, draft, index } = state;
  const errors = validate(draft, groups, { rows: file.rows, index, headers: file.headers });
  for (const f of groups.flatMap((g) => g.fields)) {
    const box = document.querySelector(`[data-field="${f.col}"]`);
    if (!box) continue;
    const msg = errors[f.col];
    const show = msg && (state.showErrors || touched.has(f.col));
    const input = box.querySelector("[data-col]");
    const err = box.querySelector(".error");
    err.hidden = !show;
    err.textContent = show ? msg : "";
    input.setAttribute("aria-invalid", show ? "true" : "false");
    input.setAttribute("aria-describedby", [`f${f.col}-help`, show && `f${f.col}-err`].filter(Boolean).join(" "));
  }
  return errors;
}

async function saveRecord(e) {
  e.preventDefault();
  state.showErrors = true;
  const errors = renderFieldErrors();
  const bad = Object.keys(errors);
  if (bad.length) {
    document.querySelector(`[data-col="${bad[0]}"]`)?.focus();
    toast(bad.length === 1 ? "Fix the highlighted field to save." : `Fix the ${bad.length} highlighted fields to save.`);
    return;
  }
  const f = state.file;
  f.marks ||= [];
  if (state.index >= 0) {
    f.rows[state.index] = [...state.draft];
    f.marks[state.index] ||= "edited";
  } else {
    f.rows.push([...state.draft]);
    f.marks[f.rows.length - 1] = "new";
  }
  const isNew = state.index < 0;
  await saveFile();
  refreshForm();
  toast(`Saved on this device. Export to update the CSV.`);
  if (isNew) {
    history.replaceState(null, "", `#row=${f.rows.length - 1}`);
    routedHash = location.hash;
    touched.clear();
    openForm(f.rows.length - 1);
  } else {
    touched.clear();
    openForm(state.index);
  }
}

async function deleteRecord() {
  const i = state.index;
  if (i == null || i < 0) return;
  const ok = await confirmDialog({
    title: `Delete ${rowLabel(state.file.rows[i])}?`,
    text: `This removes the ${itemName()} from the copy on this device. The CSV changes when you export.`,
    ok: "Delete", danger: true,
  });
  if (!ok) return;
  const f = state.file;
  const mark = f.marks?.[i];
  f.rows.splice(i, 1);
  f.marks?.splice(i, 1);
  if (mark !== "new") f.deleted = (f.deleted || 0) + 1;
  await saveFile();
  refreshForm();
  state.draft = state.base = null;
  toast("Deleted.");
  go("", { replace: true, force: true });
}

function duplicateRecord() {
  const values = [...state.draft];
  // Unique columns (the ID) must change, so start them empty.
  for (const fld of state.groups.flatMap((g) => g.fields)) if (fld.unique) values[fld.col] = "";
  state.pendingValues = values;
  go("#new", { force: true });
}

// ---------------------------------------------------------------------------
// Navigation

async function discardOk() {
  return confirmDialog({
    title: "Discard changes?",
    text: `The ${itemName()} you are editing has changes you have not saved.`,
    ok: "Discard", danger: true,
  });
}

/** Leave the open form, asking first if it has unsaved changes. Returns false to stay. */
async function leaveForm(force = false) {
  if (!force && isDirty() && !(await discardOk())) return false;
  state.index = state.draft = state.base = null;
  touched.clear();
  return true;
}

let routedHash = location.hash;
async function go(hash, { replace = false, force = false } = {}) {
  if (hash === routedHash && !force) return;
  if (!force && !(await leaveForm())) return;
  if (replace) history.replaceState(null, "", hash || location.pathname);
  else history.pushState(null, "", hash || location.pathname);
  route();
}

window.addEventListener("hashchange", async () => {
  // Back/forward buttons. Restore the old hash if the user keeps their unsaved changes.
  if (isDirty() && !(await discardOk())) {
    history.pushState(null, "", routedHash || location.pathname);
    return;
  }
  await leaveForm(true);
  route();
});

function route() {
  routedHash = location.hash;
  if (!state.file) return showView();
  const m = location.hash.match(/^#row=(\d+)$/);
  if (m && +m[1] < state.file.rows.length) {
    if (state.index !== +m[1]) openForm(+m[1]);
  } else if (location.hash === "#new") {
    openForm(-1, state.pendingValues);
    state.pendingValues = null;
  } else {
    state.index = state.draft = state.base = null;
    renderList();
  }
  showView();
  if (state.draft && matchMedia("(max-width: 819px)").matches) window.scrollTo(0, 0);
}

function showView() {
  const has = !!state.file;
  $("welcome").hidden = has;
  $("workspace").hidden = !has;
  const editing = has && state.draft != null;
  $("record").hidden = !editing;
  $("form-empty").hidden = editing;
  document.body.dataset.view = editing ? "form" : "list";
}

// ---------------------------------------------------------------------------
// Startup

function bind() {
  $("import-btn").addEventListener("click", pickAndImport);
  document.querySelector("[data-action=import]").addEventListener("click", pickAndImport);
  $("file-input").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (f) await importText(f.name, await f.text(), null);
  });
  $("export-btn").addEventListener("click", exportFile);
  $("save-file-btn").addEventListener("click", saveToHandle);
  $("remove-file-btn").addEventListener("click", removeFile);
  $("new-btn").addEventListener("click", () => go("#new"));
  $("back-btn").addEventListener("click", () => go(""));
  $("record").addEventListener("submit", saveRecord);
  $("revert-btn").addEventListener("click", () => {
    touched.clear();
    openForm(state.index, state.index >= 0 ? null : state.base);
  });
  $("delete-btn").addEventListener("click", deleteRecord);
  $("duplicate-btn").addEventListener("click", async () => {
    if (isDirty() && !(await discardOk())) return;
    duplicateRecord();
  });
  $("search").addEventListener("input", (e) => { state.query = e.target.value; renderList(); });
  $("file-select").addEventListener("change", async (e) => {
    const name = e.target.value;
    if (!(await leaveForm())) { e.target.value = state.file.name; return; }
    history.replaceState(null, "", location.pathname);
    await openFile(await store.getFile(name));
    showView();
  });
  // Drop a CSV anywhere on the window to import it.
  addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    if (!/\.csv$/i.test(f.name)) { toast("Drop a .csv file to import it."); return; }
    if (isDirty() && !(await discardOk())) return;
    await importText(f.name, await f.text(), null);
  });
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s" && state.draft) { e.preventDefault(); $("record").requestSubmit(); }
  });
  addEventListener("beforeunload", (e) => {
    if (isDirty()) e.preventDefault();
  });

  if (Intl.supportedValuesOf) {
    $("tz-list").replaceChildren(...Intl.supportedValuesOf("timeZone").map((z) => el("option", { value: z })));
  }
}

async function start() {
  bind();
  const files = await store.listFiles();
  const last = await store.getMeta("lastFile");
  const file = files.find((f) => f.name === last) || files[0];
  if (file) await openFile(file);
  route();
  // Installed app opened from a CSV in the desktop file manager (manifest file_handlers).
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async ({ files: [handle] = [] }) => {
      if (!handle) return;
      const f = await handle.getFile();
      await importText(f.name, await f.text(), handle);
    });
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

start();
