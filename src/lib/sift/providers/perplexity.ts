import { newId } from "../ids";
import { PARSER_VERSION } from "../parsers";
import type { AttachmentRecord, CanonicalConversation, CanonicalMessage, ImportBundle, ParseSkip } from "../types";
import type { ProviderAdapter } from "./types";

const PARSER = PARSER_VERSION.perplexity;

const CONVERSATION_KEYS = new Set([
  "context_uuid",
  "context_title",
  "created_at",
  "updated_at",
  "mode",
  "collection_uuid",
  "entries",
]);

const ENTRY_KEYS = new Set([
  "entry_uuid",
  "query",
  "answer",
  "created_at",
  "label",
  "query_status",
  "engine_mode",
]);

const CITATION_KEYS = ["sources", "citations", "web_results", "search_results", "references"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function unmapped(rec: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (!known.has(key)) extra[key] = value;
  }
  return extra;
}

function citationAttachments(entry: Record<string, unknown>, entryId: string): AttachmentRecord[] {
  const out: AttachmentRecord[] = [];
  for (const key of CITATION_KEYS) {
    const raw = entry[key];
    if (!Array.isArray(raw)) continue;
    raw.forEach((item, index) => {
      const rec = asRecord(item);
      const url =
        (rec && typeof rec.url === "string" && rec.url) ||
        (rec && typeof rec.link === "string" && rec.link) ||
        (typeof item === "string" ? item : undefined);
      const title = rec && typeof rec.title === "string" ? rec.title : undefined;
      out.push({
        id: newId("a"),
        sourceAttachmentId: `${entryId}:${key}:${index}`,
        kind: "url",
        filename: title,
        url: typeof url === "string" ? url : undefined,
        availability: "reference",
        metadata: {
          field: key,
          index,
          ...(rec ?? { value: item }),
          note: "Citation object from the export. Bytes were not included.",
        },
      });
    });
  }
  return out;
}

function isEntry(value: unknown): value is Record<string, unknown> {
  const rec = asRecord(value);
  if (!rec || !Array.isArray(rec.entries)) return false;
  return typeof rec.context_uuid === "string" || rec.entries.some((item) => {
    const entry = asRecord(item);
    return Boolean(entry && ("query" in entry || "answer" in entry));
  });
}

export function isPerplexityOfficialExport(data: unknown): boolean {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.conversations) || rec.conversations.length === 0) return false;
  return rec.conversations.some((row) => isEntry(row));
}

export function isUnsupportedPerplexityShape(data: unknown): boolean {
  if (isPerplexityOfficialExport(data)) return false;
  const list = Array.isArray(data) ? data : asRecord(data)?.threads;
  if (Array.isArray(list) && list.some((row) => {
    const rec = asRecord(row);
    const steps = rec?.steps;
    return Array.isArray(steps) && steps.some((step) => {
      const s = asRecord(step);
      return Boolean(s && ("query_str" in s || "final_response" in s));
    });
  })) {
    return true;
  }
  const root = asRecord(data);
  const meta = root ? asRecord(root.metadata) : null;
  if (meta && typeof meta.thread_id === "string" && Array.isArray(root?.conversations)) return true;
  return false;
}

function emptyBundle(filename: string | undefined, raw: string, extra: Partial<ImportBundle>): ImportBundle {
  return {
    provider: "perplexity",
    label: filename ? `Perplexity · ${filename}` : "Perplexity export",
    filename,
    mime: "application/json",
    conversations: [],
    warnings: [],
    skipped: [],
    failed: [],
    parser: "perplexity",
    parserVersion: PARSER,
    rawBytes: new TextEncoder().encode(raw),
    ...extra,
  };
}

function parseOfficial(data: Record<string, unknown>, filename: string | undefined, raw: string): ImportBundle {
  const rows = data.conversations as unknown[];
  const conversations: CanonicalConversation[] = [];
  const skipped: ParseSkip[] = [];
  const failed: ParseSkip[] = [];
  const unmappedKeys = new Set<string>();
  let structuredCitations = 0;
  let incompleteEntries = 0;

  for (const row of rows) {
    const conv = asRecord(row);
    if (!conv) {
      skipped.push({ reason: "Conversation row is not an object" });
      continue;
    }
    for (const key of Object.keys(unmapped(conv, CONVERSATION_KEYS))) unmappedKeys.add(`conversation.${key}`);
    const contextId = typeof conv.context_uuid === "string" ? conv.context_uuid : undefined;
    if (!Array.isArray(conv.entries)) {
      skipped.push({ reason: "Perplexity conversation has no entries array", key: contextId });
      continue;
    }
    const messages: CanonicalMessage[] = [];
    let previousEntryId: string | undefined;
    conv.entries.forEach((item, entryIndex) => {
      const entry = asRecord(item);
      if (!entry) {
        skipped.push({ reason: "Entry is not an object", key: contextId });
        return;
      }
      for (const key of Object.keys(unmapped(entry, ENTRY_KEYS))) unmappedKeys.add(`entry.${key}`);
      const entryId = typeof entry.entry_uuid === "string" ? entry.entry_uuid : undefined;
      const query = typeof entry.query === "string" ? entry.query : undefined;
      const answer = typeof entry.answer === "string" ? entry.answer : undefined;
      const timestamp = typeof entry.created_at === "string" ? entry.created_at : undefined;
      const citations = entryId ? citationAttachments(entry, entryId) : citationAttachments(entry, `entry-${entryIndex}`);
      structuredCitations += citations.length;
      if (query == null || answer == null) incompleteEntries += 1;
      const turnMeta = {
        entry_uuid: entryId ?? null,
        entry_index: entryIndex,
        label: entry.label ?? null,
        query_status: typeof entry.query_status === "string" ? entry.query_status : null,
        engine_mode: typeof entry.engine_mode === "string" ? entry.engine_mode : null,
        unmapped: unmapped(entry, ENTRY_KEYS),
      };
      if (query == null && answer == null) {
        skipped.push({ reason: "Entry has neither query nor answer", key: entryId ?? contextId });
        return;
      }
      if (query != null) {
        messages.push({
          id: newId("m"),
          sourceMessageId: entryId,
          parentSourceId: previousEntryId,
          role: "user",
          content: query,
          timestamp,
          sortIndex: messages.length,
          isOnCurrentPath: true,
          contentSha256: "",
          attachments: [],
          metadata: { ...turnMeta, part: "query" },
        });
      }
      if (answer != null) {
        messages.push({
          id: newId("m"),
          sourceMessageId: entryId,
          parentSourceId: entryId,
          role: "assistant",
          content: answer,
          timestamp,
          sortIndex: messages.length,
          isOnCurrentPath: true,
          contentSha256: "",
          attachments: citations,
          metadata: { ...turnMeta, part: "answer", structured_citation_count: citations.length },
        });
      }
      if (entryId) previousEntryId = entryId;
    });
    if (!messages.length) {
      skipped.push({ reason: "Perplexity conversation produced no messages", key: contextId });
      continue;
    }
    const title =
      typeof conv.context_title === "string" && conv.context_title.trim()
        ? conv.context_title
        : messages.find((m) => m.role === "user")?.content.slice(0, 72) || "Untitled Perplexity thread";
    conversations.push({
      id: newId("c"),
      sourceId: "",
      sourceConversationId: contextId,
      title,
      createdAt: typeof conv.created_at === "string" ? conv.created_at : undefined,
      updatedAt: typeof conv.updated_at === "string" ? conv.updated_at : undefined,
      category: "Other",
      pinned: false,
      state: "active",
      summary: "",
      contentSha256: "",
      processingStage: "normalized",
      parser: "perplexity",
      parserVersion: PARSER,
      messageCount: messages.length,
      charCount: messages.reduce((n, m) => n + m.content.length, 0),
      messages,
      metadata: {
        provider: "perplexity",
        mode: typeof conv.mode === "string" ? conv.mode : null,
        collection_uuid: typeof conv.collection_uuid === "string" ? conv.collection_uuid : conv.collection_uuid ?? null,
        entry_count: conv.entries.length,
        unmapped: unmapped(conv, CONVERSATION_KEYS),
      },
    });
  }

  const warnings = [
    structuredCitations === 0
      ? "This Perplexity export has no structured citation objects. Bracket markers inside answers were kept as text and were not turned into URLs."
      : `${structuredCitations} structured citation objects were kept as reference attachments. The export did not include their bytes.`,
  ];
  if (incompleteEntries) warnings.push(`${incompleteEntries} entries were missing a query or an answer. The side that existed was kept.`);
  if (unmappedKeys.size) warnings.push(`Unmapped fields were kept on the record, not dropped: ${[...unmappedKeys].sort().join(", ")}.`);
  if (!conversations.length) failed.push({ reason: "Perplexity export contained no importable conversations" });

  return emptyBundle(filename, raw, {
    conversations,
    warnings,
    skipped,
    failed,
    expectedConversationCount: rows.length,
  });
}

export const perplexityAdapter: ProviderAdapter = {
  id: "perplexity",
  label: "Perplexity",
  detect(raw) {
    try {
      const data = JSON.parse(raw) as unknown;
      return isPerplexityOfficialExport(data) || isUnsupportedPerplexityShape(data);
    } catch {
      return false;
    }
  },
  parse(raw, filename) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return emptyBundle(filename, raw, {
        failed: [{ reason: "Perplexity file was not valid JSON" }],
        warnings: ["Nothing was imported. The file was not reclassified as Grok or generic."],
      });
    }
    if (isPerplexityOfficialExport(data)) return parseOfficial(data as Record<string, unknown>, filename, raw);
    if (isUnsupportedPerplexityShape(data)) {
      return emptyBundle(filename, raw, {
        failed: [{
          reason:
            "This Perplexity-like export is not the official conversations file (context_uuid + entries[].query/answer). It was not imported as Grok or as a generic transcript.",
        }],
        warnings: ["Unsupported Perplexity shape. No conversations were created."],
      });
    }
    return emptyBundle(filename, raw, {
      failed: [{ reason: "File did not match the Perplexity export this adapter understands." }],
      warnings: ["Nothing was imported."],
    });
  },
};
