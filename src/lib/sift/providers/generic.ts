import { parseImportDetailed } from "@/lib/chats/parse";
import type { ImportMode } from "@/lib/chats/types";
import { newId } from "../ids";
import { PARSER_VERSION } from "../parsers";
import type { ImportBundle, ProviderId } from "../types";
import { chatsToCanonical } from "./canonical";
import type { ProviderAdapter } from "./types";

export function bundleFromText(
  raw: string,
  opts: { provider: ProviderId; label: string; filename?: string; mode?: ImportMode; mime?: string },
): ImportBundle {
  const detailed = parseImportDetailed(raw, opts.mode ?? "auto");
  const sourceId = newId("src");
  const parser = opts.provider === "grok" ? PARSER_VERSION.grok : PARSER_VERSION.generic;
  const bytes = new TextEncoder().encode(raw);
  return {
    provider: opts.provider,
    label: opts.label,
    filename: opts.filename,
    mime: opts.mime ?? "text/plain",
    conversations: chatsToCanonical(detailed.chats, sourceId, opts.provider),
    warnings: detailed.chats.length ? [] : ["No conversations found in that text."],
    skipped: detailed.skipped,
    failed: [],
    parser: opts.provider,
    parserVersion: parser,
    expectedConversationCount: detailed.expected,
    rawBytes: bytes,
  };
}

export const grokAdapter: ProviderAdapter = {
  id: "grok",
  label: "Grok",
  detect(raw, filename) {
    if (filename && /prod-grok-backend|grok/i.test(filename)) return true;
    try {
      const data = JSON.parse(raw) as unknown;
      if (!data || typeof data !== "object") return false;
      const rec = data as Record<string, unknown>;
      if (Array.isArray(rec.conversations) && rec.conversations[0] && typeof rec.conversations[0] === "object") {
        const first = rec.conversations[0] as Record<string, unknown>;
        if (typeof first.context_uuid === "string" && Array.isArray(first.entries)) return false;
        if (first.responses || first.conversation || first.messages) return true;
      }
    } catch {
      return false;
    }
    return false;
  },
  parse(raw, filename) {
    return bundleFromText(raw, {
      provider: "grok",
      label: filename ? `Grok · ${filename}` : "Grok export",
      filename,
      mime: "application/json",
    });
  },
};

export const genericAdapter: ProviderAdapter = {
  id: "generic",
  label: "Generic",
  detect() {
    return true;
  },
  parse(raw, filename) {
    return bundleFromText(raw, {
      provider: "generic",
      label: filename ? `Import · ${filename}` : "Pasted text",
      filename,
    });
  },
};
