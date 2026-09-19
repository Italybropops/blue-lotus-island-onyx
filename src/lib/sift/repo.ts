import { hashMessages, sha256Hex } from "./hash";
import { newId } from "./ids";
import { openSqlite, persistNow, schedulePersist, withLock } from "./sqlite";
import type {
  CanonicalConversation,
  CanonicalMessage,
  ConversationState,
  ImportBundle,
  ProcessingStage,
  ProviderId,
  RelationshipKind,
  RelationshipRecord,
  SourceRecord,
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
      notes: r.notes ? String(r.notes) : undefined,
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
      category: String(r.category ?? "Other"),
      pinned: Number(r.pinned) === 1,
      state: String(r.state) as ConversationState,
      summary: String(r.summary ?? ""),
      contentSha256: String(r.content_sha256),
      processingStage: String(r.processing_stage) as ProcessingStage,
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
      role: String(r.role) as CanonicalMessage["role"],
      content: String(r.content ?? ""),
      timestamp: r.timestamp ? String(r.timestamp) : undefined,
      sortIndex: Number(r.sort_index ?? 0),
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
}> {
  const db = await openSqlite();
  const sourceId = freshId("sources", undefined, "src", db);
  const importedAt = new Date().toISOString();
  const rawSha = rawText ? await sha256Hex(rawText.slice(0, 2_000_000)) : undefined;
  const prepared = [];
  for (const conv of bundle.conversations) {
    prepared.push({ conv, hashes: await hashMessages(conv.messages) });
  }

  db.run("BEGIN");
  try {
    db.run(
      `INSERT INTO sources (id, provider, label, imported_at, raw_filename, raw_sha256, notes, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceId,
        bundle.provider,
        labelOr(bundle),
        importedAt,
        bundle.filename ?? null,
        rawSha ?? null,
        bundle.warnings.join("\n") || null,
        JSON.stringify({ conversationCount: bundle.conversations.length }),
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
    const now = importedAt;

    for (const { conv, hashes } of prepared) {
      const id = freshId("conversations", conv.id, "c", db);
      const charCount = conv.messages.reduce((n, m) => n + m.content.length, 0);
      db.run(
        `INSERT INTO conversations (
          id, source_id, source_conversation_id, title, created_at, updated_at, category,
          pinned, state, summary, content_sha256, processing_stage, message_count, char_count, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          sourceId,
          conv.sourceConversationId ?? conv.id ?? null,
          conv.title,
          conv.createdAt ?? now,
          conv.updatedAt ?? conv.createdAt ?? now,
          conv.category || "Other",
          conv.pinned ? 1 : 0,
          conv.state || "active",
          conv.summary ?? "",
          hashes.conversation,
          "hashed",
          conv.messages.length,
          charCount,
          JSON.stringify(conv.metadata ?? {}),
        ],
      );
      conv.messages.forEach((m, i) => {
        const msgId = freshId("messages", m.id, "m", db);
        db.run(
          `INSERT INTO messages (
            id, conversation_id, source_message_id, role, content, timestamp, sort_index, content_sha256, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            msgId,
            id,
            m.sourceMessageId ?? m.id ?? null,
            m.role,
            m.content,
            m.timestamp ?? null,
            m.sortIndex ?? i,
            hashes.messages[i] ?? "",
            JSON.stringify(m.metadata ?? {}),
          ],
        );
        for (const att of m.attachments ?? []) {
          db.run(
            `INSERT INTO attachments (id, message_id, conversation_id, kind, filename, mime, sha256, url, bytes_len, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              freshId("attachments", att.id, "a", db),
              msgId,
              id,
              att.kind,
              att.filename ?? null,
              att.mime ?? null,
              att.sha256 ?? null,
              att.url ?? null,
              att.bytesLen ?? null,
              JSON.stringify(att.metadata ?? {}),
            ],
          );
        }
      });
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
            now,
          ],
        );
        exactDuplicateLinks += 1;
      } else {
        existingHashes.set(hashes.conversation, id);
      }
    }

    db.run("COMMIT");
    schedulePersist();
    await persistNow();
    return { sourceId, inserted, exactDuplicateLinks };
  } catch (err) {
    try {
      db.run("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  }
}

function labelOr(bundle: ImportBundle): string {
  return bundle.label;
}

export async function insertImport(bundle: ImportBundle, rawText?: string): Promise<{
  sourceId: string;
  inserted: number;
  exactDuplicateLinks: number;
}> {
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
  exactDuplicates: number;
  schemaVersion: string;
}> {
  const db = await openSqlite();
  const n = (sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0);
  const ver = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  return {
    conversations: n("SELECT COUNT(*) FROM conversations"),
    messages: n("SELECT COUNT(*) FROM messages"),
    sources: n("SELECT COUNT(*) FROM sources"),
    exactDuplicates: n("SELECT COUNT(*) FROM relationships WHERE kind = 'exact_duplicate'"),
    schemaVersion: String(ver[0]?.values[0]?.[0] ?? "0"),
  };
}
