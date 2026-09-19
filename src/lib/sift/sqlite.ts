import type { Database } from "sql.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

const IDB_NAME = "sift-archive-v1";
const IDB_STORE = "kv";
const IDB_KEY = "sqlite";

let db: Database | null = null;
let opening: Promise<Database> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lock: Promise<void> = Promise.resolve();

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

async function loadDump(): Promise<Uint8Array | null> {
  try {
    const database = await idb();
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(asBytes(req.result));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveDump(bytes: Uint8Array): Promise<void> {
  const database = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function applySchema(database: Database): void {
  database.exec(SCHEMA_SQL);
  const row = database.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  const current = row[0]?.values[0]?.[0];
  if (current == null) {
    database.run("INSERT INTO meta (key, value) VALUES (?, ?)", ["schema_version", String(SCHEMA_VERSION)]);
  }
}

async function initSql(): Promise<import("sql.js").SqlJsStatic> {
  const initSqlJs = (await import("sql.js")).default;
  return initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
}

export async function openSqlite(): Promise<Database> {
  if (db) return db;
  if (opening) return opening;
  opening = (async () => {
    const SQL = await initSql();
    const dump = await loadDump();
    const instance = dump ? new SQL.Database(dump) : new SQL.Database();
    applySchema(instance);
    db = instance;
    return instance;
  })();
  try {
    return await opening;
  } catch (err) {
    opening = null;
    throw err;
  }
}

/** Serialize archive writes. Not re-entrant — callers must not nest. */
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release: () => void = () => undefined;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(() => release());
}

export function schedulePersist(): void {
  if (typeof window === "undefined" || !db) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistNow();
  }, 200);
}

export async function persistNow(): Promise<void> {
  if (!db) return;
  try {
    const bytes = db.export();
    await saveDump(bytes);
  } catch (err) {
    console.error("sift archive persist failed", err);
  }
}

export async function exportSqliteBytes(): Promise<Uint8Array> {
  const database = await openSqlite();
  return database.export();
}

export async function replaceSqlite(bytes: Uint8Array): Promise<void> {
  return withLock(async () => {
    const SQL = await initSql();
    const instance = new SQL.Database(bytes);
    applySchema(instance);
    db = instance;
    await persistNow();
  });
}
