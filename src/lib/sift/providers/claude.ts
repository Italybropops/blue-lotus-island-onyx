import { newId } from "../ids";
import { PARSER_VERSION } from "../parsers";
import type { AttachmentRecord, CanonicalConversation, CanonicalMessage, ImportBundle, ParseSkip } from "../types";
import type { ProviderAdapter } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function claudeAttachments(rec: Record<string, unknown>): AttachmentRecord[] {
  const raw = rec.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const a = asRecord(item) ?? {};
    const filename = typeof a.file_name === "string" ? a.file_name : typeof a.filename === "string" ? a.filename : undefined;
    const extracted = typeof a.extracted_content === "string" ? a.extracted_content : undefined;
    return {
      id: newId("a"),
      sourceAttachmentId: typeof a.id === "string" ? a.id : typeof a.file_id === "string" ? a.file_id : undefined,
      kind: /\.(png|jpe?g|gif|webp)$/i.test(filename ?? "") ? "image" : "file",
      filename,
      mime: typeof a.file_type === "string" ? a.file_type : undefined,
      availability: extracted ? "unavailable" : "reference",
      metadata: { ...a, extracted_content: extracted ? "[present in export; stored in metadata length only]" : undefined, extracted_len: extracted?.length },
    };
  });
}

function parseConversation(row: Record<string, unknown>): CanonicalConversation | ParseSkip {
  const rawMessages = row.chat_messages ?? row.messages;
  if (!Array.isArray(rawMessages)) return { reason: "Claude thread has no chat_messages", key: String(row.uuid ?? row.name ?? "") };
  const messages: CanonicalMessage[] = [];
  rawMessages.forEach((item, i) => {
    const rec = asRecord(item);
    if (!rec) return;
    const text = String(rec.text ?? rec.content ?? "").trim();
    const attachments = claudeAttachments(rec);
    if (!text && !attachments.length) return;
    const sender = String(rec.sender ?? rec.role ?? "human").toLowerCase();
    const role: CanonicalMessage["role"] = sender === "assistant" || sender === "claude" ? "assistant" : "user";
    messages.push({
      id: newId("m"),
      sourceMessageId: typeof rec.uuid === "string" ? rec.uuid : undefined,
      role,
      content: text,
      timestamp: typeof rec.created_at === "string" ? rec.created_at : undefined,
      sortIndex: i,
      isOnCurrentPath: true,
      contentSha256: "",
      attachments,
      metadata: {},
    });
  });
  if (!messages.length) return { reason: "Claude thread had no messages", key: String(row.uuid ?? "") };
  return {
    id: newId("c"),
    sourceId: "",
    sourceConversationId: typeof row.uuid === "string" ? row.uuid : undefined,
    title: typeof row.name === "string" && row.name.trim() ? row.name : messages[0].content.slice(0, 72),
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
    category: "Other",
    pinned: false,
    state: "active",
    summary: "",
    contentSha256: "",
    processingStage: "normalized",
    parser: "claude",
    parserVersion: PARSER_VERSION.claude,
    messageCount: messages.length,
    charCount: messages.reduce((n, m) => n + m.content.length, 0),
    messages,
    metadata: { provider: "claude" },
  };
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  label: "Claude",
  detect(raw) {
    try {
      const data = JSON.parse(raw) as unknown;
      const rows = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { conversations?: unknown }).conversations)
          ? (data as { conversations: unknown[] }).conversations
          : null;
      if (!rows?.[0] || typeof rows[0] !== "object") return false;
      return "chat_messages" in (rows[0] as object);
    } catch {
      return false;
    }
  },
  parse(raw, filename) {
    const warnings: string[] = [];
    const skipped: ParseSkip[] = [];
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return {
        provider: "claude",
        label: "Claude export",
        filename,
        conversations: [],
        warnings: ["File is not valid JSON."],
        skipped: [],
        failed: [{ reason: "Invalid JSON" }],
        parser: "claude",
        parserVersion: PARSER_VERSION.claude,
      };
    }
    const rows = Array.isArray(data)
      ? data
      : asRecord(data) && Array.isArray(asRecord(data)!.conversations)
        ? (asRecord(data)!.conversations as unknown[])
        : [];
    const conversations: CanonicalConversation[] = [];
    rows.forEach((row, index) => {
      const rec = asRecord(row);
      if (!rec) {
        skipped.push({ reason: "Row is not an object", index });
        return;
      }
      const parsed = parseConversation(rec);
      if ("reason" in parsed && !("messages" in parsed)) {
        skipped.push({ ...parsed, index });
        return;
      }
      conversations.push(parsed as CanonicalConversation);
    });
    if (!conversations.length) warnings.push("No Claude threads with chat_messages were found.");
    return {
      provider: "claude",
      label: filename ? `Claude · ${filename}` : "Claude export",
      filename,
      conversations,
      warnings,
      skipped,
      failed: [],
      parser: "claude",
      parserVersion: PARSER_VERSION.claude,
      expectedConversationCount: rows.length,
    };
  },
};
