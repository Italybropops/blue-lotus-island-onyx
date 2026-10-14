/**
 * Blob store for raw exports and attachment bytes.
 *
 * Browser bridge (this file): OPFS if the browser allows it, else IndexedDB
 * `sift-blobs-v1`. This is NOT a Mac folder and NOT a SQLite blob column.
 *
 * Eventual local backend should implement the same path contract on disk:
 *   raw/{provider}/{sourceId}/original
 *   raw/{provider}/{sourceId}/manifest.json
 *   attachments/{attachmentId}
 *   backups/{stamp}.sqlite
 */

export type BlobBackend = "opfs" | "indexeddb" | "memory" | "none";

const IDB_NAME = "sift-blobs-v1";
const IDB_STORE = "blobs";

let backend: BlobBackend | null = null;
let memory = new Map<string, Uint8Array>();

export function blobPath(kind: "raw" | "attachments" | "backups", ...parts: string[]): string {
  return [kind, ...parts.map(encodeURIComponent)].join("/");
}

export function rawOriginalPath(provider: string, sourceId: string, ext = "bin"): string {
  return `raw/${provider}/${sourceId}/original.${ext.replace(/^\./, "")}`;
}

export function rawManifestPath(provider: string, sourceId: string): string {
  return `raw/${provider}/${sourceId}/manifest.json`;
}

export function attachmentPath(id: string): string {
  return `attachments/${id}`;
}

export function backupPath(stamp: string): string {
  return `backups/${stamp}.sqlite`;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== "undefined" && value instanceof Blob) return null;
  return null;
}

async function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tryOpfs(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const nav = navigator as Navigator & { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } };
    if (!nav.storage?.getDirectory) return null;
    const root = await nav.storage.getDirectory();
    return await root.getDirectoryHandle("sift-archive", { create: true });
  } catch {
    return null;
  }
}

async function opfsWalk(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return { dir, name };
}

async function detectBackend(): Promise<BlobBackend> {
  if (typeof window === "undefined") return "memory";
  if (await tryOpfs()) return "opfs";
  try {
    await idb();
    return "indexeddb";
  } catch {
    return "memory";
  }
}

export async function blobBackend(): Promise<BlobBackend> {
  if (!backend) backend = await detectBackend();
  return backend;
}

export async function putBlob(path: string, bytes: Uint8Array): Promise<{ backend: BlobBackend }> {
  const copy = copyBytes(bytes);
  const kind = await blobBackend();
  if (kind === "opfs") {
    const root = await tryOpfs();
    if (!root) {
      backend = "indexeddb";
      return putBlob(path, copy);
    }
    const loc = await opfsWalk(root, path, true);
    if (!loc) throw new Error("Invalid blob path");
    const handle = await loc.dir.getFileHandle(loc.name, { create: true });
    const writable = await handle.createWritable();
    const ab = new ArrayBuffer(copy.byteLength);
    new Uint8Array(ab).set(copy);
    await writable.write(ab);
    await writable.close();
    return { backend: "opfs" };
  }
  if (kind === "indexeddb") {
    const database = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(copy, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return { backend: "indexeddb" };
  }
  if (kind === "memory") {
    memory.set(path, copy);
    return { backend: "memory" };
  }
  throw new Error("Blob store is not available in this browser.");
}

export async function getBlob(path: string): Promise<Uint8Array | null> {
  const kind = await blobBackend();
  if (kind === "opfs") {
    try {
      const root = await tryOpfs();
      if (!root) return null;
      const loc = await opfsWalk(root, path, false);
      if (!loc) return null;
      const handle = await loc.dir.getFileHandle(loc.name);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }
  if (kind === "indexeddb") {
    const database = await idb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(path);
      req.onsuccess = () => resolve(asBytes(req.result));
      req.onerror = () => reject(req.error);
    });
  }
  if (kind === "memory") return memory.get(path) ? copyBytes(memory.get(path)!) : null;
  return null;
}

export async function hasBlob(path: string): Promise<boolean> {
  return (await getBlob(path)) != null;
}

export function extFromName(filename?: string, mime?: string): string {
  const fromName = filename?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  if (mime === "application/json") return "json";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
  if (mime === "text/plain") return "txt";
  if (mime === "text/markdown") return "md";
  return "bin";
}

/** Node/tests: force the in-memory backend. */
export function useMemoryBlobStore(): void {
  backend = "memory";
  memory = new Map();
}
