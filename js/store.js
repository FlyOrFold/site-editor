// On-device storage in IndexedDB. Nothing here leaves the device.
//
// files:   one record per imported CSV, keyed by file name:
//          { name, headers, rows, original, lineEnding, bom, importedAt, savedAt, exportedAt }
//          `original` is the rows as imported or last exported, used to mark changed rows.
// handles: FileSystemFileHandle per file name, where the browser supports writing back to
//          the file that was opened (Chrome and Edge on desktop).
// meta:    small settings, such as the file last open.

const DB_NAME = "site-editor";
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("files", { keyPath: "name" });
      db.createObjectStore("handles");
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listFiles = () => run("files", "readonly", (s) => s.getAll());
export const getFile = (name) => run("files", "readonly", (s) => s.get(name));
export const putFile = (file) => run("files", "readwrite", (s) => s.put(file));
export const deleteFile = async (name) => {
  await run("files", "readwrite", (s) => s.delete(name));
  await run("handles", "readwrite", (s) => s.delete(name));
};

export const getHandle = (name) => run("handles", "readonly", (s) => s.get(name));
export const putHandle = (name, handle) => run("handles", "readwrite", (s) => s.put(handle, name));
export const clearHandle = (name) => run("handles", "readwrite", (s) => s.delete(name));

export const getMeta = (key) => run("meta", "readonly", (s) => s.get(key));
export const setMeta = (key, value) => run("meta", "readwrite", (s) => s.put(value, key));

/** Ask the browser not to evict our data under storage pressure. Best effort. */
export async function persist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}
