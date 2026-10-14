import type { Database } from "sql.js";
import { backupPath, getBlob, putBlob } from "./blob-store";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import type { ArchivePeek } from "./types";

const IDB_NAME = "sift-archive-v1";
const IDB_STORE = "kv";
const IDB_KEY = "sqlite";

let db: Database | null = null;
let opening: Promise<Database> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lock: Promise<void> = Promise.resolve();
let dirty = false;
let persistError: string | null = null;
const persistListeners = new Set<(err: string | null) => void>();

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

function enableForeignKeys(database: Database): void {
  database.run("PRAGMA foreign_keys = ON");
}

function schemaVersion(database: Database): number {
  try {
    const row = database.exec("SELECT value FROM meta WHERE key = 'schema_version'");
    return Number(row[0]?.values[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

function tableExists(database: Database, name: string): boolean {
  const row = database.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`);
  return Boolean(row[0]?.values[0]?.[0]);
}

function migrateIfNeeded(database: Database): void {
  enableForeignKeys(database);
  const ver = schemaVersion(database);
  if (!tableExists(database, "conversations")) {
    database.exec(SCHEMA_SQL);
    database.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["schema_version", String(SCHEMA_VERSION)]);
    enableForeignKeys(database);
    return;
  }
  if (ver >= SCHEMA_VERSION) {
    enableForeignKeys(database);
    return;
  }
  database.run("PRAGMA foreign_keys = OFF");
  const now = new Date().toISOString();
  const sources = tableExists(database, "sources") ? database.exec("SELECT * FROM sources") : [];
  const convs = database.exec("SELECT * FROM conversations");
  const msgs = tableExists(database, "messages") ? database.exec("SELECT * FROM messages") : [];
  const atts = tableExists(database, "attachments") ? database.exec("SELECT * FROM attachments") : [];
  const rels = tableExists(database, "relationships") ? database.exec("SELECT * FROM relationships") : [];
  const settings = tableExists(database, "settings") ? database.exec("SELECT * FROM settings") : [];

  for (const name of ["attachments", "messages", "relationships", "conversations", "sources", "knowledge_items", "embeddings", "analysis_results", "processing_jobs", "settings"]) {
    if (tableExists(database, name)) database.run(`DROP TABLE ${name}`);
  }
  database.exec(SCHEMA_SQL);

  const col = (result: { columns: string[]; values: unknown[][] } | undefined, row: unknown[], name: string) => {
    if (!result) return null;
    const i = result.columns.indexOf(name);
    return i >= 0 ? row[i] : null;
  };

  const src = sources[0];
  if (src) {
    for (const row of src.values) {
      database.run(
        `INSERT INTO sources (id, provider, label, imported_at, raw_filename, raw_sha256, parser, parser_version, status, notes, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          col(src, row, "id"),
          col(src, row, "provider"),
          col(src, row, "label"),
          col(src, row, "imported_at") ?? now,
          col(src, row, "raw_filename"),
          col(src, row, "raw_sha256"),
          col(src, row, "parser") ?? "generic",
          col(src, row, "parser_version") ?? "generic@legacy",
          "complete",
          col(src, row, "notes"),
          col(src, row, "metadata_json") ?? "{}",
        ],
      );
    }
  }
  const cv = convs[0];
  if (cv) {
    for (const row of cv.values) {
      database.run(
        `INSERT INTO conversations (id, source_id, source_conversation_id, title, created_at, updated_at, imported_at, category, pinned, state, summary, content_sha256, processing_stage, message_count, char_count, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          col(cv, row, "id"),
          col(cv, row, "source_id"),
          col(cv, row, "source_conversation_id"),
          col(cv, row, "title"),
          col(cv, row, "created_at"),
          col(cv, row, "updated_at"),
          col(cv, row, "imported_at") ?? now,
          col(cv, row, "category") ?? "Other",
          col(cv, row, "pinned") ?? 0,
          col(cv, row, "state") ?? "active",
          col(cv, row, "summary") ?? "",
          col(cv, row, "content_sha256") ?? "",
          col(cv, row, "processing_stage") ?? "imported",
          col(cv, row, "message_count") ?? 0,
          col(cv, row, "char_count") ?? 0,
          col(cv, row, "metadata_json") ?? "{}",
        ],
      );
    }
  }
  const ms = msgs[0];
  if (ms) {
    for (const row of ms.values) {
      database.run(
        `INSERT INTO messages (id, conversation_id, source_message_id, role, content, timestamp, sort_index, is_on_current_path, content_sha256, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          col(ms, row, "id"),
          col(ms, row, "conversation_id"),
          col(ms, row, "source_message_id"),
          col(ms, row, "role"),
          col(ms, row, "content") ?? "",
          col(ms, row, "timestamp"),
          col(ms, row, "sort_index") ?? 0,
          col(ms, row, "content_sha256") ?? "",
          col(ms, row, "metadata_json") ?? "{}",
        ],
      );
    }
  }
  const at = atts[0];
  if (at) {
    for (const row of at.values) {
      database.run(
        `INSERT INTO attachments (id, message_id, conversation_id, kind, filename, mime, sha256, url, bytes_len, availability, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unavailable', ?)`,
        [
          col(at, row, "id"),
          col(at, row, "message_id"),
          col(at, row, "conversation_id"),
          col(at, row, "kind") ?? "other",
          col(at, row, "filename"),
          col(at, row, "mime"),
          col(at, row, "sha256"),
          col(at, row, "url"),
          col(at, row, "bytes_len"),
          col(at, row, "metadata_json") ?? "{}",
        ],
      );
    }
  }
  const rl = rels[0];
  if (rl) {
    for (const row of rl.values) {
      database.run(
        `INSERT INTO relationships (id, kind, from_id, to_id, score, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          col(rl, row, "id"),
          col(rl, row, "kind"),
          col(rl, row, "from_id"),
          col(rl, row, "to_id"),
          col(rl, row, "score"),
          col(rl, row, "reason"),
          col(rl, row, "created_at") ?? now,
        ],
      );
    }
  }
  const st = settings[0];
  if (st) {
    for (const row of st.values) {
      database.run("INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)", [col(st, row, "key"), col(st, row, "value_json")]);
    }
  }
  database.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["schema_version", String(SCHEMA_VERSION)]);
  enableForeignKeys(database);
}

async function initSql(): Promise<import("sql.js").SqlJsStatic> {
  const initSqlJs = (await import("sql.js")).default;
  return initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
}

export async function openSqlite(): Promise<Database> {
  if (db) {
    enableForeignKeys(db);
    return db;
  }
  if (opening) return opening;
  opening = (async () => {
    const SQL = await initSql();
    const dump = await loadDump();
    const instance = dump ? new SQL.Database(dump) : new SQL.Database();
    migrateIfNeeded(instance);
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

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release: () => void = () => undefined;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(() => release());
}

export function markDirty(): void {
  dirty = true;
}

export function getPersistError(): string | null {
  return persistError;
}

export function subscribePersistError(fn: (err: string | null) => void): () => void {
  persistListeners.add(fn);
  return () => persistListeners.delete(fn);
}

function notifyPersist(err: string | null): void {
  persistError = err;
  persistListeners.forEach((fn) => fn(err));
}

export function schedulePersist(): void {
  dirty = true;
  if (typeof window === "undefined" || !db) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistNow();
  }, 800);
}

export async function persistNow(): Promise<{ ok: boolean; error?: string }> {
  if (!db) return { ok: true };
  try {
    enableForeignKeys(db);
    const bytes = db.export();
    if (typeof window === "undefined") {
      dirty = false;
      notifyPersist(null);
      return { ok: true };
    }
    await saveDump(bytes);
    dirty = false;
    notifyPersist(null);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save the archive in this browser.";
    notifyPersist(message);
    return { ok: false, error: message };
  }
}

export async function exportSqliteBytes(): Promise<Uint8Array> {
  const database = await openSqlite();
  return database.export();
}

export async function peekSqliteBytes(bytes: Uint8Array, filename: string): Promise<ArchivePeek> {
  const SQL = await initSql();
  const instance = new SQL.Database(bytes);
  try {
    const n = (sql: string) => {
      try {
        return Number(instance.exec(sql)[0]?.values[0]?.[0] ?? 0);
      } catch {
        return 0;
      }
    };
    const ver = (() => {
      try {
        return String(instance.exec("SELECT value FROM meta WHERE key = 'schema_version'")[0]?.values[0]?.[0] ?? "unknown");
      } catch {
        return "unknown";
      }
    })();
    return {
      conversations: n("SELECT COUNT(*) FROM conversations"),
      messages: n("SELECT COUNT(*) FROM messages"),
      sources: n("SELECT COUNT(*) FROM sources"),
      schemaVersion: ver,
      filename,
      byteLength: bytes.byteLength,
    };
  } finally {
    instance.close();
  }
}

export async function snapshotBackup(): Promise<string | null> {
  if (!db) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bytes = db.export();
  try {
    await putBlob(backupPath(stamp), bytes);
    return stamp;
  } catch {
    return null;
  }
}

export async function replaceSqlite(bytes: Uint8Array): Promise<void> {
  return withLock(async () => {
    const SQL = await initSql();
    const instance = new SQL.Database(bytes);
    migrateIfNeeded(instance);
    enableForeignKeys(instance);
    db = instance;
    dirty = true;
    const saved = await persistNow();
    if (!saved.ok) throw new Error(saved.error ?? "Restored in memory but could not persist.");
  });
}

export async function restoreArchiveFromBytes(bytes: Uint8Array): Promise<{ backupStamp: string | null }> {
  const stamp = await snapshotBackup();
  try {
    await replaceSqlite(bytes);
    return { backupStamp: stamp };
  } catch (err) {
    if (stamp) {
      const prev = await getBlob(backupPath(stamp));
      if (prev) await replaceSqlite(prev);
    }
    throw err;
  }
}

export function foreignKeysEnabled(database: Database): boolean {
  const row = database.exec("PRAGMA foreign_keys");
  return Number(row[0]?.values[0]?.[0] ?? 0) === 1;
}
