import { newId } from "../ids";
import type { CanonicalConversation, CanonicalMessage, ImportBundle } from "../types";
import type { ProviderAdapter } from "./types";

interface GptNode {
  id?: string;
  parent?: string | null;
  message?: {
    id?: string;
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
    create_time?: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function flattenParts(parts: unknown[] | undefined): { text: string; attachments: CanonicalMessage["attachments"] } {
  const attachments: CanonicalMessage["attachments"] = [];
  const texts: string[] = [];
  for (const part of parts ?? []) {
    if (typeof part === "string") {
      texts.push(part);
      continue;
    }
    const rec = asRecord(part);
    if (!rec) continue;
    if (typeof rec.text === "string") texts.push(rec.text);
    const asset = asRecord(rec.asset_pointer) ?? rec;
    if (rec.content_type === "image_asset_pointer" || typeof rec.asset_pointer === "string") {
      attachments.push({
        id: newId("a"),
        kind: "image",
        url: typeof rec.asset_pointer === "string" ? rec.asset_pointer : undefined,
        metadata: rec,
      });
    }
  }
  return { text: texts.join("\n"), attachments };
}

function isoFromUnix(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const ms = value < 1e12 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function linearize(mapping: Record<string, GptNode>, current: string | undefined): GptNode[] {
  const chain: GptNode[] = [];
  let id = current;
  const guard = new Set<string>();
  while (id && mapping[id] && !guard.has(id)) {
    guard.add(id);
    chain.push(mapping[id]);
    id = mapping[id].parent ?? undefined;
  }
  return chain.reverse();
}

function parseOne(row: Record<string, unknown>): CanonicalConversation | null {
  const mappingRaw = asRecord(row.mapping);
  if (!mappingRaw) return null;
  const mapping = mappingRaw as unknown as Record<string, GptNode>;
  const nodes = linearize(mapping, typeof row.current_node === "string" ? row.current_node : undefined);
  const messages: CanonicalMessage[] = [];
  let i = 0;
  for (const node of nodes) {
    const msg = node.message;
    if (!msg) continue;
    const roleRaw = String(msg.author?.role ?? "");
    if (roleRaw === "system" || roleRaw === "tool") continue;
    const { text, attachments } = flattenParts(msg.content?.parts);
    if (!text.trim() && attachments.length === 0) continue;
    const role = roleRaw === "assistant" ? "assistant" : "user";
    messages.push({
      id: newId("m"),
      sourceMessageId: msg.id ?? node.id,
      role,
      content: text,
      timestamp: isoFromUnix(msg.create_time),
      sortIndex: i++,
      contentSha256: "",
      attachments,
      metadata: { content_type: msg.content?.content_type },
    });
  }
  if (!messages.length) return null;
  return {
    id: newId("c"),
    sourceId: "",
    sourceConversationId: typeof row.id === "string" ? row.id : typeof row.conversation_id === "string" ? row.conversation_id : undefined,
    title: typeof row.title === "string" && row.title.trim() ? row.title : messages[0].content.slice(0, 72),
    createdAt: isoFromUnix(row.create_time),
    updatedAt: isoFromUnix(row.update_time) ?? isoFromUnix(row.create_time),
    category: "Other",
    pinned: false,
    state: "active",
    summary: "",
    contentSha256: "",
    processingStage: "normalized",
    messageCount: messages.length,
    charCount: messages.reduce((n, m) => n + m.content.length, 0),
    messages,
    metadata: { provider: "chatgpt" },
  };
}

export const chatgptAdapter: ProviderAdapter = {
  id: "chatgpt",
  label: "ChatGPT",
  detect(raw, filename) {
    if (filename && /conversations\.json$/i.test(filename)) {
      try {
        const data = JSON.parse(raw) as unknown;
        if (Array.isArray(data) && data[0] && typeof data[0] === "object" && "mapping" in data[0]) return true;
      } catch {
        return false;
      }
    }
    try {
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data) && data.length && asRecord(data[0])?.mapping) return true;
    } catch {
      return false;
    }
    return false;
  },
  parse(raw, filename) {
    const warnings: string[] = [];
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return { provider: "chatgpt", label: "ChatGPT export", filename, conversations: [], warnings: ["File is not valid JSON."] };
    }
    const rows = Array.isArray(data) ? data : [];
    const conversations = rows
      .map((row) => (asRecord(row) ? parseOne(asRecord(row)!) : null))
      .filter((c): c is CanonicalConversation => Boolean(c));
    if (!conversations.length) warnings.push("No ChatGPT threads with a mapping tree were found.");
    return {
      provider: "chatgpt",
      label: filename ? `ChatGPT · ${filename}` : "ChatGPT export",
      filename,
      conversations,
      warnings,
    };
  },
};
