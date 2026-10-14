import { attachmentPath, blobBackend, extFromName, putBlob, rawManifestPath, rawOriginalPath } from "./blob-store";
import { hashMessages, sha256Bytes, sha256Hex } from "./hash";
import { newId } from "./ids";
import { parserVersionFor } from "./parsers";
import { markDirty, openSqlite, persistNow, schedulePersist, withLock } from "./sqlite";
import { validateArchive } from "./validate";
import type {
  AttachmentRecord,
  CanonicalConversation,
  CanonicalMessage,
  ConversationState,
  ImportBundle,
  ImportManifest,
  ProcessingStage,
  ProviderId,
  RelationshipKind,
  RelationshipRecord,
  SourceRecord,
  SourceStatus,
} from "./types";

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function listSources(): Promise<SourceRecord[]> {
  const db = await openSqlite();
  const stmt = db.prepare("SELECT * FROM sources ORDER BY imported_at DESC");
  const rows: SourceRecord[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    rows.push({
      id: String(r.id),
      provider: String(r.provider) as ProviderId,
      label: String(r.label),
      importedAt: String(r.imported_at),
      rawFilename: r.raw_filename ? String(r.raw_filename) : undefined,
      rawSha256: r.raw_sha256 ? String(r.raw_sha256) : undefined,
      byteLength: r.byte_length == null ? undefined : Number(r.byte_length),
      mime: r.mime ? String(r.mime) : undefined,
      parser: String(r.parser ?? ""),
      parserVersion: String(r.parser_version ?? ""),
      status: String(r.status ?? "complete") as SourceStatus,
      rawRetained: Number(r.raw_retained) === 1,
      rawBackend: r.raw_backend ? String(r.raw_backend) : undefined,
      conversationCount: Number(r.conversation_count ?? 0),
      messageCount: Number(r.message_count ?? 0),
      attachmentCount: Number(r.attachment_count ?? 0),
      skippedCount: Number(r.skipped_count ?? 0),
      failedCount: Number(r.failed_count ?? 0),
      notes: r.notes ? String(r.notes) : undefined,
      manifest: parseJson(r.manifest_json),
      metadata: parseJson(r.metadata_json),
    });
  }
  stmt.free();
  return rows;
}

export async function conversationCount(): Promise<number> {
  const db = await openSqlite();
  const res = db.exec("SELECT COUNT(*) AS n FROM conversations");
  return Number(res[0]?.values[0]?.[0] ?? 0);
}

export async function loadAllConversations(): Promise<CanonicalConversation[]> {
  const db = await openSqlite();
  const convStmt = db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC, created_at DESC");
  const convs: CanonicalConversation[] = [];
  while (convStmt.step()) {
    const r = convStmt.getAsObject();
    convs.push({
      id: String(r.id),
      sourceId: String(r.source_id),
      sourceConversationId: r.source_conversation_id ? String(r.source_conversation_id) : undefined,
      title: String(r.title),
      createdAt: r.created_at ? String(r.created_at) : undefined,
      updatedAt: r.updated_at ? String(r.updated_at) : undefined,
      importedAt: r.imported_at ? String(r.imported_at) : undefined,
      category: String(r.category ?? "Other"),
      pinned: Number(r.pinned) === 1,
      state: String(r.state) as ConversationState,
      summary: String(r.summary ?? ""),
      contentSha256: String(r.content_sha256),
      processingStage: String(r.processing_stage) as ProcessingStage,
      parser: r.parser ? String(r.parser) : undefined,
      parserVersion: r.parser_version ? String(r.parser_version) : undefined,
      currentSourceNodeId: r.current_source_node_id ? String(r.current_source_node_id) : undefined,
      messageCount: Number(r.message_count ?? 0),
      charCount: Number(r.char_count ?? 0),
      messages: [],
      metadata: parseJson(r.metadata_json),
    });
  }
  convStmt.free();

  const msgStmt = db.prepare(
    "SELECT * FROM messages ORDER BY conversation_id, sort_index",
  );
  const byConv = new Map<string, CanonicalMessage[]>();
  while (msgStmt.step()) {
    const r = msgStmt.getAsObject();
    const conversationId = String(r.conversation_id);
    const list = byConv.get(conversationId) ?? [];
    list.push({
      id: String(r.id),
      sourceMessageId: r.source_message_id ? String(r.source_message_id) : undefined,
      parentSourceId: r.parent_source_id ? String(r.parent_source_id) : undefined,
      role: String(r.role) as CanonicalMessage["role"],
      content: String(r.content ?? ""),
      timestamp: r.timestamp ? String(r.timestamp) : undefined,
      sortIndex: Number(r.sort_index ?? 0),
      isOnCurrentPath: Number(r.is_on_current_path ?? 1) === 1,
      contentSha256: String(r.content_sha256 ?? ""),
      attachments: [],
      metadata: parseJson(r.metadata_json),
    });
    byConv.set(conversationId, list);
  }
  msgStmt.free();

  for (const conv of convs) {
    conv.messages = byConv.get(conv.id) ?? [];
  }

  const attStmt = db.prepare("SELECT * FROM attachments");
  while (attStmt.step()) {
    const r = attStmt.getAsObject();
    const att: AttachmentRecord = {
      id: String(r.id),
      sourceAttachmentId: r.source_attachment_id ? String(r.source_attachment_id) : undefined,
      messageId: r.message_id ? String(r.message_id) : undefined,
      conversationId: r.conversation_id ? String(r.conversation_id) : undefined,
      kind: String(r.kind ?? "other") as AttachmentRecord["kind"],
      filename: r.filename ? String(r.filename) : undefined,
      mime: r.mime ? String(r.mime) : undefined,
      sha256: r.sha256 ? String(r.sha256) : undefined,
      url: r.url ? String(r.url) : undefined,
      bytesLen: r.bytes_len == null ? undefined : Number(r.bytes_len),
      availability: String(r.availability ?? "unavailable") as AttachmentRecord["availability"],
      localKey: r.local_key ? String(r.local_key) : undefined,
      metadata: parseJson(r.metadata_json),
    };
    const conv = convs.find((c) => c.id === att.conversationId);
    const msg = conv?.messages.find((m) => m.id === att.messageId);
    if (msg) msg.attachments.push(att);
  }
  attStmt.free();
  return convs;
}

function idTaken(table: "conversations" | "messages" | "attachments" | "sources", id: string, db: import("sql.js").Database): boolean {
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  stmt.bind([id]);
  const hit = stmt.step();
  stmt.free();
  return hit;
}

function freshId(table: "conversations" | "messages" | "attachments" | "sources", preferred: string | undefined, prefix: string, db: import("sql.js").Database): string {
  if (preferred && !idTaken(table, preferred, db)) return preferred;
  let id = newId(prefix);
  while (idTaken(table, id, db)) id = newId(prefix);
  return id;
}

async function insertImportInner(bundle: ImportBundle, rawText?: string): Promise<{
  sourceId: string;
  inserted: number;
  exactDuplicateLinks: number;
  skipped: number;
  failed: number;
  rawRetained: boolean;
  persistOk: boolean;
  persistError?: string;
  validationOk: boolean;
  manifest: ImportManifest;
}> {
  const db = await openSqlite();
  const sourceId = freshId("sources", undefined, "src", db);
  bundle.skipped ??= [];
  bundle.failed ??= [];
  bundle.warnings ??= [];
  const importedAt = new Date().toISOString();
  const parser = bundle.parser || bundle.provider;
  const parserVersion = bundle.parserVersion || parserVersionFor(bundle.provider);
  const rawBytes = bundle.rawBytes ?? (rawText ? new TextEncoder().encode(rawText) : undefined);
  const byteLength = rawBytes?.byteLength;
  const rawSha = rawBytes ? await sha256Bytes(rawBytes) : undefined;

  let rawRetained = false;
  let rawBackend: string | undefined;
  let rawWarning: string | undefined;
  if (rawBytes && rawBytes.byteLength > 0) {
    try {
      const ext = extFromName(bundle.filename, bundle.mime);
      const path = rawOriginalPath(bundle.provider, sourceId, ext);
      const stored = await putBlob(path, rawBytes);
      rawRetained = true;
      rawBackend = stored.backend;
      const manifestObj: ImportManifest = {
        source_id: sourceId,
        provider: bundle.provider,
        filename: bundle.filename,
        original_sha256: rawSha,
        byte_size: byteLength,
        imported_at: importedAt,
        parser,
        parser_version: parserVersion,
        conversation_count: bundle.conversations.length,
        message_count: bundle.conversations.reduce((n, c) => n + c.messages.length, 0),
        attachment_count: bundle.conversations.reduce((n, c) => n + c.messages.reduce((m, msg) => m + (msg.attachments?.length ?? 0), 0), 0),
        skipped_count: bundle.skipped.length,
        failed_count: bundle.failed.length,
        status: bundle.failed.length ? "partial" : "complete",
        raw_retained: true,
        raw_backend: stored.backend,
        warnings: bundle.warnings,
      };
      await putBlob(rawManifestPath(bundle.provider, sourceId), new TextEncoder().encode(JSON.stringify(manifestObj, null, 2)));
    } catch (err) {
      rawRetained = false;
      rawWarning = err instanceof Error ? err.message : "Could not keep the original file in this browser.";
    }
  } else {
    rawWarning = "No original bytes were provided (typed paste without a file).";
  }

  const prepared: { conv: CanonicalConversation; hashes: { conversation: string; messages: string[] } }[] = [];
  for (const conv of bundle.conversations) {
    prepared.push({ conv, hashes: await hashMessages(conv.messages) });
  }

  const messageCount = bundle.conversations.reduce((n, c) => n + c.messages.length, 0);
  const attachmentCount = bundle.conversations.reduce(
    (n, c) => n + c.messages.reduce((m, msg) => m + (msg.attachments?.length ?? 0), 0),
    0,
  );
  const status: SourceStatus = bundle.failed.length
    ? "failed"
    : !rawRetained && rawBytes
      ? "raw_not_retained"
      : bundle.skipped.length
        ? "partial"
        : "complete";

  const manifest: ImportManifest = {
    source_id: sourceId,
    provider: bundle.provider,
    filename: bundle.filename,
    original_sha256: rawSha,
    byte_size: byteLength,
    imported_at: importedAt,
    parser,
    parser_version: parserVersion,
    conversation_count: bundle.conversations.length,
    message_count: messageCount,
    attachment_count: attachmentCount,
    skipped_count: bundle.skipped.length,
    failed_count: bundle.failed.length,
    status,
    raw_retained: rawRetained,
    raw_backend: rawBackend,
    warnings: [...bundle.warnings, ...(rawWarning ? [rawWarning] : [])],
  };

  db.run("BEGIN");
  try {
    db.run(
      `INSERT INTO sources (
        id, provider, label, imported_at, raw_filename, raw_sha256, byte_length, mime,
        parser, parser_version, status, raw_retained, raw_backend,
        conversation_count, message_count, attachment_count, skipped_count, failed_count,
        notes, manifest_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceId,
        bundle.provider,
        bundle.label,
        importedAt,
        bundle.filename ?? null,
        rawSha ?? null,
        byteLength ?? null,
        bundle.mime ?? null,
        parser,
        parserVersion,
        status,
        rawRetained ? 1 : 0,
        rawBackend ?? null,
        bundle.conversations.length,
        messageCount,
        attachmentCount,
        bundle.skipped.length,
        bundle.failed.length,
        [...bundle.warnings, ...(rawWarning ? [rawWarning] : [])].join("\n") || null,
        JSON.stringify(manifest),
        JSON.stringify({ skipped: bundle.skipped, failed: bundle.failed, expected: bundle.expectedConversationCount ?? null }),
      ],
    );

    const existingHashes = new Map<string, string>();
    const hashStmt = db.prepare("SELECT id, content_sha256 FROM conversations");
    while (hashStmt.step()) {
      const r = hashStmt.getAsObject();
      existingHashes.set(String(r.content_sha256), String(r.id));
    }
    hashStmt.free();

    let inserted = 0;
    let exactDuplicateLinks = 0;

    for (const { conv, hashes } of prepared) {
      const id = freshId("conversations", conv.id, "c", db);
      const charCount = conv.messages.reduce((n, m) => n + m.content.length, 0);
      db.run(
        `INSERT INTO conversations (
          id, source_id, source_conversation_id, title, created_at, updated_at, imported_at, category,
          pinned, state, summary, content_sha256, processing_stage, parser, parser_version, current_source_node_id,
          message_count, char_count, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          sourceId,
          conv.sourceConversationId ?? null,
          conv.title,
          conv.createdAt ?? null,
          conv.updatedAt ?? null,
          importedAt,
          conv.category || "Other",
          conv.pinned ? 1 : 0,
          conv.state || "active",
          conv.summary ?? "",
          hashes.conversation,
          "hashed",
          parser,
          parserVersion,
          conv.currentSourceNodeId ?? null,
          conv.messages.length,
          charCount,
          JSON.stringify({ ...conv.metadata, provider: bundle.provider }),
        ],
      );
      for (let i = 0; i < conv.messages.length; i++) {
        const m = conv.messages[i];
        const msgId = freshId("messages", m.id, "m", db);
        db.run(
          `INSERT INTO messages (
            id, conversation_id, source_message_id, parent_source_id, role, content, timestamp,
            sort_index, is_on_current_path, content_sha256, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            msgId,
            id,
            m.sourceMessageId ?? null,
            m.parentSourceId ?? null,
            m.role,
            m.content,
            m.timestamp ?? null,
            m.sortIndex ?? i,
            m.isOnCurrentPath === false ? 0 : 1,
            hashes.messages[i] ?? "",
            JSON.stringify(m.metadata ?? {}),
          ],
        );
        for (const att of m.attachments ?? []) {
          let localKey: string | null = att.localKey ?? null;
          let availability = att.availability ?? (att.url ? "reference" : "unavailable");
          const attId = freshId("attachments", att.id, "a", db);
          const extraBytes = (att.metadata as { bytes?: Uint8Array }).bytes;
          if (extraBytes instanceof Uint8Array && extraBytes.byteLength) {
            try {
              localKey = attachmentPath(attId);
              await putBlob(localKey, extraBytes);
              availability = "local";
            } catch {
              availability = "unavailable";
              localKey = null;
            }
          }
          db.run(
            `INSERT INTO attachments (
              id, message_id, conversation_id, source_attachment_id, kind, filename, mime, sha256, url,
              bytes_len, availability, local_key, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              attId,
              msgId,
              id,
              att.sourceAttachmentId ?? null,
              att.kind,
              att.filename ?? null,
              att.mime ?? null,
              att.sha256 ?? null,
              att.url ?? null,
              att.bytesLen ?? extraBytes?.byteLength ?? null,
              availability,
              localKey,
              JSON.stringify(att.metadata ?? {}),
            ],
          );
        }
      }
      inserted += 1;
      const match = existingHashes.get(hashes.conversation);
      if (match && match !== id) {
        db.run(
          `INSERT INTO relationships (id, kind, from_id, to_id, score, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            newId("rel"),
            "exact_duplicate",
            id,
            match,
            1,
            "SHA-256 of normalized messages matches an existing conversation. Both records are kept.",
            importedAt,
          ],
        );
        exactDuplicateLinks += 1;
      } else {
        existingHashes.set(hashes.conversation, id);
      }
    }

    db.run("COMMIT");
    markDirty();
    const saved = await persistNow();
    const validation = await validateArchive();
    return {
      sourceId,
      inserted,
      exactDuplicateLinks,
      skipped: bundle.skipped.length,
      failed: bundle.failed.length,
      rawRetained,
      persistOk: saved.ok,
      persistError: saved.error,
      validationOk: validation.ok,
      manifest,
    };
  } catch (err) {
    try {
      db.run("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function insertImport(bundle: ImportBundle, rawText?: string) {
  return withLock(() => insertImportInner(bundle, rawText));
}

/** Used by bootstrap so it can lock count+insert together. */
export async function insertImportUnlocked(bundle: ImportBundle, rawText?: string) {
  return insertImportInner(bundle, rawText);
}

export async function updateConversation(
  id: string,
  patch: {
    title?: string;
    category?: string;
    pinned?: boolean;
    state?: ConversationState;
    summary?: string;
  },
): Promise<void> {
  const db = await openSqlite();
  const stmt = db.prepare("SELECT * FROM conversations WHERE id = ?");
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return;
  }
  const row = stmt.getAsObject();
  stmt.free();
  db.run(
    `UPDATE conversations SET title = ?, category = ?, pinned = ?, state = ?, summary = ?, updated_at = ? WHERE id = ?`,
    [
      patch.title ?? row.title,
      patch.category ?? row.category,
      patch.pinned == null ? row.pinned : patch.pinned ? 1 : 0,
      patch.state ?? row.state,
      patch.summary ?? row.summary,
      new Date().toISOString(),
      id,
    ],
  );
  schedulePersist();
}

export async function addRelationship(rel: Omit<RelationshipRecord, "id" | "createdAt"> & { id?: string }): Promise<void> {
  const db = await openSqlite();
  db.run(
    `INSERT INTO relationships (id, kind, from_id, to_id, score, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      rel.id ?? newId("rel"),
      rel.kind,
      rel.fromId,
      rel.toId,
      rel.score ?? null,
      rel.reason ?? null,
      new Date().toISOString(),
    ],
  );
  schedulePersist();
}

export async function listRelationships(): Promise<RelationshipRecord[]> {
  const db = await openSqlite();
  const stmt = db.prepare("SELECT * FROM relationships");
  const rows: RelationshipRecord[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    rows.push({
      id: String(r.id),
      kind: String(r.kind) as RelationshipKind,
      fromId: String(r.from_id),
      toId: String(r.to_id),
      score: r.score == null ? undefined : Number(r.score),
      reason: r.reason ? String(r.reason) : undefined,
      createdAt: String(r.created_at),
    });
  }
  stmt.free();
  return rows;
}

export async function getSetting(key: string): Promise<unknown> {
  const db = await openSqlite();
  const stmt = db.prepare("SELECT value_json FROM settings WHERE key = ?");
  stmt.bind([key]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const value = String(stmt.getAsObject().value_json ?? "null");
  stmt.free();
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await openSqlite();
  db.run("INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)", [key, JSON.stringify(value)]);
  schedulePersist();
}

export async function archiveStats(): Promise<{
  conversations: number;
  messages: number;
  sources: number;
  attachments: number;
  exactDuplicates: number;
  rawRetained: number;
  schemaVersion: string;
}> {
  const db = await openSqlite();
  const n = (sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0);
  const ver = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  return {
    conversations: n("SELECT COUNT(*) FROM conversations"),
    messages: n("SELECT COUNT(*) FROM messages"),
    sources: n("SELECT COUNT(*) FROM sources"),
    attachments: n("SELECT COUNT(*) FROM attachments"),
    exactDuplicates: n("SELECT COUNT(*) FROM relationships WHERE kind = 'exact_duplicate'"),
    rawRetained: n("SELECT COUNT(*) FROM sources WHERE raw_retained = 1"),
    schemaVersion: String(ver[0]?.values[0]?.[0] ?? "0"),
  };
}
