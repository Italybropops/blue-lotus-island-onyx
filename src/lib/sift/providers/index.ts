import { chatgptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { genericAdapter, grokAdapter } from "./generic";
import type { ProviderAdapter } from "./types";
import type { ImportBundle, ProviderId } from "../types";

const ADAPTERS: ProviderAdapter[] = [chatgptAdapter, claudeAdapter, grokAdapter];

export function detectProvider(raw: string, filename?: string): ProviderAdapter {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(raw, filename)) return adapter;
  }
  return genericAdapter;
}

export function parseWithAdapters(raw: string, filename?: string): ImportBundle {
  return detectProvider(raw, filename).parse(raw, filename);
}

export function parseForced(provider: ProviderId, raw: string, filename?: string): ImportBundle {
  const adapter = ADAPTERS.find((a) => a.id === provider) ?? genericAdapter;
  return adapter.parse(raw, filename);
}

export { chatgptAdapter, claudeAdapter, grokAdapter, genericAdapter };
export type { ProviderAdapter };
