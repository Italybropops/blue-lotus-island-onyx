import { newId } from "../ids";
import type { CanonicalConversation, CanonicalMessage, ImportBundle } from "../types";
import type { ProviderAdapter } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseConversation(row: Record<string, unknown>): CanonicalConversation | null {
  const rawMessages = row.chat_messages ?? row.messages;
  if (!Array.isArray(rawMessages)) return null;
  const messages: CanonicalMessage[] = [];
  rawMessages.forEach((item, i) => {
    const rec = asRecord(item);
    if (!rec) return;
    const text = String(rec.text ?? rec.content ?? "").trim();
    if (!text) return;
    const sender = String(rec.sender ?? rec.role ?? "human").toLowerCase();
    const role = sender === "assistant" || sender === "claude" ? "assistant" : "user";
    messages.push({
      id: newId("m"),
      sourceMessageId: typeof rec.uuid === "string" ? rec.uuid : undefined,
      role,
      content: text,
      timestamp: typeof rec.created_at === "string" ? rec.created_at : undefined,
      sortIndex: i,
      contentSha256: "",
      attachments: [],
      metadata: {},
    });
  });
  if (!messages.length) return null;
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
      const rows = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { conversations?: unknown }).conversations)
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
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return { provider: "claude", label: "Claude export", filename, conversations: [], warnings: ["File is not valid JSON."] };
    }
    const rows = Array.isArray(data)
      ? data
      : asRecord(data) && Array.isArray(asRecord(data)!.conversations)
        ? (asRecord(data)!.conversations as unknown[])
        : [];
    const conversations = rows
      .map((row) => (asRecord(row) ? parseConversation(asRecord(row)!) : null))
      .filter((c): c is CanonicalConversation => Boolean(c));
    if (!conversations.length) warnings.push("No Claude threads with chat_messages were found.");
    return {
      provider: "claude",
      label: filename ? `Claude · ${filename}` : "Claude export",
      filename,
      conversations,
      warnings,
    };
  },
};
