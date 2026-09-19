import { parseImport } from "@/lib/chats/parse";
import type { ImportMode } from "@/lib/chats/types";
import { newId } from "../ids";
import type { ImportBundle, ProviderId } from "../types";
import { chatsToCanonical } from "./canonical";
import type { ProviderAdapter } from "./types";

export function bundleFromText(
  raw: string,
  opts: { provider: ProviderId; label: string; filename?: string; mode?: ImportMode },
): ImportBundle {
  const chats = parseImport(raw, opts.mode ?? "auto");
  const sourceId = newId("src");
  return {
    provider: opts.provider,
    label: opts.label,
    filename: opts.filename,
    conversations: chatsToCanonical(chats, sourceId, opts.provider),
    warnings: chats.length ? [] : ["No conversations found in that text."],
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
