import type { Category, Chat, ImportMode, Message } from "./types";
import { CATEGORIES } from "./types";

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "your",
  "have",
  "are",
  "was",
  "were",
  "you",
  "but",
  "not",
  "can",
  "just",
  "about",
  "what",
  "when",
  "how",
  "why",
  "who",
  "please",
  "like",
  "need",
  "want",
  "make",
  "help",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function newId(prefix = "c"): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asCategory(value: unknown): Category {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) {
    return value as Category;
  }
  return "Other";
}

function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "Untitled chat";
  const cut = line.slice(0, 72);
  return cut.length < line.length ? `${cut.replace(/[,:;.\s]+$/, "")}…` : cut;
}

function firstSentence(text: string, max = 140): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const cut = compact.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = (cut?.[1] ?? compact).trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : sentence;
}

export function summaryFrom(messages: Message[]): string {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const lastAsst = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const asked = firstSentence(user, 110);
  const outcome = firstSentence(lastAsst, 90);
  if (asked && outcome) {
    const joined = `${asked} → ${outcome}`;
    return joined.length > 220 ? `${joined.slice(0, 217)}…` : joined;
  }
  if (asked) return asked.length > 180 ? `${asked.slice(0, 177)}…` : asked;
  if (outcome) return outcome;
  return "Empty chat";
}

function toChat(partial: {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  importedAt?: string;
  sourceConversationId?: string;
  messages: Message[];
  category?: Category;
  source?: Chat["source"];
}): Chat {
  const importedAt = partial.importedAt ?? new Date().toISOString();
  const messages = partial.messages.length
    ? partial.messages
    : [{ id: newId("m"), role: "user" as const, content: "" }];
  return {
    id: newId("c"),
    title: partial.title?.trim() || titleFrom(messages[0]?.content ?? ""),
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    importedAt,
    messages,
    source: partial.source ?? "import",
    status: "active",
    category: partial.category ?? "Other",
    pinned: false,
    archived: false,
    summary: summaryFrom(messages),
    sourceConversationId: partial.sourceConversationId,
  };
}

const SPEAKER = /^(user|you|human|me|grok|assistant|model|chatgpt|ai)\s*[:.\-–]?\s*$/i;
const SPEAKER_INLINE = /^(user|you|human|me|grok|assistant|model)\s*[:.\-–]\s*(.*)$/i;
const TIME_ONLY =
  /^(?:\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m|just now|yesterday|today|\d+\s*(?:s|m|h|d|sec|min|hr|hour|day)s?\s*ago)$/i;

function stripDecor(line: string): string {
  return line
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/^#+\s+/, "")
    .trim();
}

function parseTranscript(block: string): { title?: string; messages: Message[] } {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const messages: Message[] = [];
  let role: Message["role"] | null = null;
  let buf: string[] = [];
  let inferredTitle: string | undefined;

  const flush = () => {
    const content = buf.join("\n").trim();
    if (role && content) {
      messages.push({ id: newId("m"), role, content });
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = stripDecor(line);
    if (!trimmed) {
      if (role) buf.push("");
      continue;
    }
    if (TIME_ONLY.test(trimmed)) continue;

    if (SPEAKER.test(trimmed)) {
      flush();
      const key = trimmed.toLowerCase();
      role = key.startsWith("user") || key === "you" || key === "human" || key === "me" ? "user" : "assistant";
      continue;
    }
    const inline = trimmed.match(SPEAKER_INLINE);
    if (inline) {
      flush();
      const key = inline[1].toLowerCase();
      role = key === "you" || key === "human" || key === "me" || key === "user" ? "user" : "assistant";
      buf = [inline[2]];
      continue;
    }

    if (!role && messages.length === 0 && buf.length === 0 && trimmed.length <= 80) {
      const next = lines
        .slice(i + 1)
        .map(stripDecor)
        .find((l) => l.length > 0);
      if (next && (SPEAKER.test(next) || SPEAKER_INLINE.test(next))) {
        inferredTitle = trimmed;
        continue;
      }
    }

    if (role) buf.push(line.trimEnd());
    else buf.push(line.trimEnd());
  }
  if (!role && buf.some((l) => l.trim())) {
    role = "user";
  }
  flush();
  return { title: inferredTitle, messages };
}

function splitBlocks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/^\s*(?:-{3,}|\*{3,}|={3,}|_{3,})\s*$/m);
  const blocks = parts.map((p) => p.trim()).filter(Boolean);
  return blocks.length ? blocks : [trimmed];
}

function mongoDate(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 0 && value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{12,}$/.test(trimmed)) {
      const d = new Date(Number(trimmed));
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    return undefined;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (rec.$numberLong != null) return mongoDate(rec.$numberLong);
    if (rec.$date != null) return mongoDate(rec.$date);
    if (typeof rec.seconds === "number") return mongoDate(rec.seconds * 1000);
  }
  return undefined;
}

function flattenContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          return String(p.text ?? p.content ?? p.value ?? "");
        }
        return "";
      })
      .join("");
  }
  if (raw && typeof raw === "object") {
    const p = raw as Record<string, unknown>;
    return String(p.text ?? p.content ?? p.value ?? "");
  }
  return "";
}

function messageFromUnknown(m: unknown): Message | null {
  if (!m || typeof m !== "object") return null;
  const rec = m as Record<string, unknown>;
  const nested = rec.message;
  const src =
    nested && typeof nested === "object" && !Array.isArray(nested) && !("content" in rec && typeof rec.content === "string")
      ? { ...(nested as Record<string, unknown>), ...rec }
      : rec;
  const content = flattenContent(
    src.content ?? src.message ?? src.text ?? src.prompt ?? src.body ?? src.input ?? src.output,
  ).trim();
  if (!content) return null;
  const roleRaw = String(src.role ?? src.sender ?? src.author ?? src.from ?? rec.role ?? "user").toLowerCase();
  if (roleRaw.includes("system") && !roleRaw.includes("assistant")) return null;
  const role: Message["role"] = /assistant|grok|model|bot/.test(roleRaw) && !roleRaw.includes("user") ? "assistant" : "user";
  const timestamp = mongoDate(src.create_time ?? src.createdAt ?? src.created_at ?? src.timestamp ?? rec.create_time);
  const sourceMessageId =
    typeof src.id === "string"
      ? src.id
      : typeof src.message_id === "string"
        ? src.message_id
        : typeof rec.id === "string"
          ? rec.id
          : undefined;
  if (roleRaw === "human" || roleRaw === "you" || roleRaw === "me") {
    return { id: newId("m"), role: "user", content, timestamp, sourceMessageId };
  }
  return { id: newId("m"), role, content, timestamp, sourceMessageId };
}

function chatFromRecord(row: Record<string, unknown>): Chat | null {
  const nested = row.conversation;
  const conv = nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : row;
  const rawMessages = row.messages ?? row.responses ?? row.turns ?? row.history ?? conv.messages ?? conv.responses ?? conv.turns;
  const messages: Message[] = Array.isArray(rawMessages)
    ? rawMessages.map(messageFromUnknown).filter((m): m is Message => Boolean(m))
    : [];

  if (!messages.length) {
    const text = flattenContent(row.content ?? row.text ?? row.prompt ?? conv.content).trim();
    if (text) messages.push({ id: newId("m"), role: "user", content: text });
  }
  if (!messages.length) return null;

  const title =
    (typeof conv.title === "string" && conv.title) ||
    (typeof row.title === "string" && row.title) ||
    (typeof row.name === "string" && row.name) ||
    undefined;

  const createdAt = mongoDate(
    conv.createdAt ?? conv.created_at ?? conv.create_time ?? conv.created ?? row.createdAt ?? row.created_at ?? row.create_time,
  );
  const updatedAt =
    mongoDate(conv.updatedAt ?? conv.updated_at ?? conv.update_time ?? row.updatedAt ?? row.updated_at ?? row.update_time) ??
    createdAt;

  const sourceConversationId =
    (typeof conv.id === "string" && conv.id) ||
    (typeof row.conversationId === "string" && row.conversationId) ||
    (typeof row.conversation_id === "string" && row.conversation_id) ||
    (typeof row.id === "string" && row.id) ||
    undefined;

  return toChat({
    title,
    createdAt,
    updatedAt,
    sourceConversationId: sourceConversationId || undefined,
    messages,
    category: asCategory(conv.category ?? row.category),
  });
}

export interface ParseDiagnostics {
  chats: Chat[];
  skipped: { reason: string; key?: string }[];
  expected?: number;
}

function parseJsonChats(data: unknown): ParseDiagnostics | null {
  const out: Chat[] = [];
  const skipped: { reason: string; key?: string }[] = [];
  collectChats(data, out, skipped, 0);
  return out.length || skipped.length ? { chats: out, skipped, expected: out.length + skipped.length } : null;
}

function collectChats(
  data: unknown,
  out: Chat[],
  skipped: { reason: string; key?: string }[],
  depth: number,
): void {
  if (depth > 16 || data == null) return;

  if (Array.isArray(data)) {
    const objectCount = data.filter((x) => x && typeof x === "object").length;
    let mapped = 0;
    for (const row of data) {
      if (!row || typeof row !== "object") {
        skipped.push({ reason: "Array item is not an object" });
        continue;
      }
      const chat = chatFromRecord(row as Record<string, unknown>);
      if (chat) {
        out.push(chat);
        mapped += 1;
      }
    }
    if (mapped && mapped >= Math.max(1, objectCount * 0.5)) return;
    if (mapped) return;
    for (const item of data) collectChats(item, out, skipped, depth + 1);
    return;
  }

  if (typeof data !== "object") return;
  const rec = data as Record<string, unknown>;

  for (const key of ["conversations", "chats", "threads", "items", "data", "history", "grok_conversations"]) {
    if (rec[key] != null) {
      const before = out.length;
      collectChats(rec[key], out, skipped, depth + 1);
      if (out.length > before) return;
    }
  }

  const one = chatFromRecord(rec);
  if (one && (Array.isArray(rec.messages) || Array.isArray(rec.responses) || Array.isArray(rec.turns) || rec.conversation)) {
    out.push(one);
    return;
  }

  for (const [key, value] of Object.entries(rec)) {
    if (key === "account" || key === "user" || key === "profile") continue;
    if (value && typeof value === "object") collectChats(value, out, skipped, depth + 1);
  }
}

function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => stripDecor(l))
    .filter((l) => l.length > 0 && !TIME_ONLY.test(l));
}

function looksLikeTitleList(text: string): boolean {
  if (/^\s*(?:-{3,}|\*{3,}|={3,})/m.test(text) && splitBlocks(text).length > 1) return false;
  const lines = nonEmptyLines(text);
  if (lines.length < 8) return false;
  if (lines.some((l) => SPEAKER.test(l) || SPEAKER_INLINE.test(l))) return false;
  if (lines.some((l) => l.length > 80)) return false;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  return avg <= 48;
}

function parseTitleList(text: string): Chat[] {
  return nonEmptyLines(text)
    .filter((line) => line.length >= 2)
    .map((line) =>
      toChat({
        title: titleFrom(line),
        messages: [{ id: newId("m"), role: "user", content: line }],
      }),
    );
}

function parseTranscripts(text: string): Chat[] {
  return splitBlocks(text).map((block) => {
    const heading = block.match(/^\s{0,3}#{1,3}\s+(.+)$/m);
    const title = heading?.[1]?.trim();
    const body = heading ? block.replace(heading[0], "").trim() : block;
    const parsed = parseTranscript(body);
    const messages = parsed.messages.length
      ? parsed.messages
      : [{ id: newId("m"), role: "user" as const, content: body }];
    return toChat({ title: title || parsed.title, messages });
  });
}

export function parseImport(raw: string, mode: ImportMode = "auto"): Chat[] {
  return parseImportDetailed(raw, mode).chats;
}

export function parseImportDetailed(raw: string, mode: ImportMode = "auto"): ParseDiagnostics {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return { chats: [], skipped: [] };

  if (mode === "titles") return { chats: parseTitleList(text), skipped: [] };
  if (mode === "transcripts") return { chats: parseTranscripts(text), skipped: [] };

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const json = JSON.parse(text) as unknown;
      const fromJson = parseJsonChats(json);
      if (fromJson && (fromJson.chats.length || fromJson.skipped.length)) return fromJson;
    } catch {
      return { chats: [], skipped: [{ reason: "Invalid JSON" }] };
    }
  }

  const jsonl = parseJsonLines(text);
  if (jsonl.length >= 2) return { chats: jsonl, skipped: [] };

  if (looksLikeTitleList(text)) return { chats: parseTitleList(text), skipped: [] };
  return { chats: parseTranscripts(text), skipped: [] };
}

function parseJsonLines(text: string): Chat[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.startsWith("{") || l.startsWith("["));
  if (lines.length < 2) return [];
  const chats: Chat[] = [];
  for (const line of lines) {
    try {
      const parsed = parseJsonChats(JSON.parse(line) as unknown);
      if (parsed) chats.push(...parsed.chats);
    } catch {
      // skip malformed line; caller sees overall parse
    }
  }
  return chats;
}

export function userText(chat: Chat): string {
  return chat.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

export function allText(chat: Chat): string {
  return `${chat.title}\n${chat.messages.map((m) => m.content).join("\n")}`;
}

export function charCount(chat: Chat): number {
  return chat.messages.reduce((n, m) => n + m.content.length, 0);
}
