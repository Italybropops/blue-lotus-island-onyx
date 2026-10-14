import { newId } from "../ids";
import { PARSER_VERSION } from "../parsers";
import type { AttachmentRecord, CanonicalConversation, CanonicalMessage, ImportBundle, ParseSkip } from "../types";
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

function isoFromUnix(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const ms = value < 1e12 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function flattenParts(parts: unknown[] | undefined): { text: string; attachments: AttachmentRecord[] } {
  const attachments: AttachmentRecord[] = [];
  const texts: string[] = [];
  for (const part of parts ?? []) {
    if (typeof part === "string") {
      texts.push(part);
      continue;
    }
    const rec = asRecord(part);
    if (!rec) continue;
    if (typeof rec.text === "string") texts.push(rec.text);
    if (rec.content_type === "image_asset_pointer" || typeof rec.asset_pointer === "string") {
      const pointer = typeof rec.asset_pointer === "string" ? rec.asset_pointer : undefined;
      attachments.push({
        id: newId("a"),
        sourceAttachmentId: pointer,
        kind: "image",
        url: pointer,
        availability: "reference",
        metadata: rec,
      });
    }
  }
  return { text: texts.join("\n"), attachments };
}

function currentPathIds(mapping: Record<string, GptNode>, current: string | undefined): Set<string> {
  const ids = new Set<string>();
  let id = current;
  const guard = new Set<string>();
  while (id && mapping[id] && !guard.has(id)) {
    guard.add(id);
    ids.add(id);
    id = mapping[id].parent ?? undefined;
  }
  return ids;
}

function parseOne(row: Record<string, unknown>): CanonicalConversation | ParseSkip {
  const mappingRaw = asRecord(row.mapping);
  if (!mappingRaw) return { reason: "ChatGPT thread has no mapping tree", key: String(row.id ?? row.title ?? "") };
  const mapping = mappingRaw as unknown as Record<string, GptNode>;
  const nodeIds = Object.keys(mapping);
  if (!nodeIds.length) return { reason: "ChatGPT mapping is empty", key: String(row.id ?? "") };

  const current = typeof row.current_node === "string" ? row.current_node : undefined;
  const onPath = currentPathIds(mapping, current);
  const messages: CanonicalMessage[] = [];
  let i = 0;
  for (const nodeId of nodeIds) {
    const node = mapping[nodeId];
    const msg = node.message;
    if (!msg) continue;
    const roleRaw = String(msg.author?.role ?? "user");
    const { text, attachments } = flattenParts(msg.content?.parts);
    if (!text.trim() && attachments.length === 0 && roleRaw === "system") {
      messages.push({
        id: newId("m"),
        sourceMessageId: msg.id ?? node.id ?? nodeId,
        parentSourceId: node.parent ?? undefined,
        role: "system",
        content: text,
        timestamp: isoFromUnix(msg.create_time),
        sortIndex: i++,
        isOnCurrentPath: onPath.has(nodeId),
        contentSha256: "",
        attachments,
        metadata: { content_type: msg.content?.content_type, node_id: nodeId },
      });
      continue;
    }
    if (!text.trim() && attachments.length === 0) continue;
    const role: CanonicalMessage["role"] =
      roleRaw === "assistant" ? "assistant" : roleRaw === "system" ? "system" : roleRaw === "tool" ? "tool" : "user";
    messages.push({
      id: newId("m"),
      sourceMessageId: msg.id ?? node.id ?? nodeId,
      parentSourceId: node.parent ?? undefined,
      role,
      content: text,
      timestamp: isoFromUnix(msg.create_time),
      sortIndex: i++,
      isOnCurrentPath: onPath.has(nodeId),
      contentSha256: "",
      attachments,
      metadata: { content_type: msg.content?.content_type, node_id: nodeId },
    });
  }
  if (!messages.length) return { reason: "ChatGPT thread had no messages", key: String(row.id ?? row.title ?? "") };

  const sourceConversationId = typeof row.id === "string" ? row.id : typeof row.conversation_id === "string" ? row.conversation_id : undefined;
  const visible = messages.filter((m) => m.isOnCurrentPath && (m.role === "user" || m.role === "assistant"));
  const titleSource = visible[0]?.content ?? messages.find((m) => m.content.trim())?.content ?? "";
  return {
    id: newId("c"),
    sourceId: "",
    sourceConversationId,
    title: typeof row.title === "string" && row.title.trim() ? row.title : titleSource.slice(0, 72),
    createdAt: isoFromUnix(row.create_time),
    updatedAt: isoFromUnix(row.update_time) ?? isoFromUnix(row.create_time),
    category: "Other",
    pinned: false,
    state: "active",
    summary: "",
    contentSha256: "",
    processingStage: "normalized",
    parser: "chatgpt",
    parserVersion: PARSER_VERSION.chatgpt,
    currentSourceNodeId: current,
    messageCount: messages.length,
    charCount: messages.reduce((n, m) => n + m.content.length, 0),
    messages,
    metadata: { provider: "chatgpt", node_count: nodeIds.length, current_node: current },
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
    const skipped: ParseSkip[] = [];
    const failed: ParseSkip[] = [];
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return {
        provider: "chatgpt",
        label: "ChatGPT export",
        filename,
        conversations: [],
        warnings: ["File is not valid JSON."],
        skipped: [],
        failed: [{ reason: "Invalid JSON" }],
        parser: "chatgpt",
        parserVersion: PARSER_VERSION.chatgpt,
        expectedConversationCount: 0,
      };
    }
    const rows = Array.isArray(data) ? data : [];
    const conversations: CanonicalConversation[] = [];
    rows.forEach((row, index) => {
      const rec = asRecord(row);
      if (!rec) {
        skipped.push({ reason: "Row is not an object", index });
        return;
      }
      const parsed = parseOne(rec);
      if ("reason" in parsed && !("messages" in parsed)) {
        skipped.push({ ...parsed, index });
        return;
      }
      conversations.push(parsed as CanonicalConversation);
    });
    if (!conversations.length) warnings.push("No ChatGPT threads with a mapping tree were found.");
    return {
      provider: "chatgpt",
      label: filename ? `ChatGPT · ${filename}` : "ChatGPT export",
      filename,
      conversations,
      warnings,
      skipped,
      failed,
      parser: "chatgpt",
      parserVersion: PARSER_VERSION.chatgpt,
      expectedConversationCount: rows.length,
    };
  },
};
