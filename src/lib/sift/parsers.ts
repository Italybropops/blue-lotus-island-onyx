import type { ProviderId } from "./types";

/** Parser identity stored on every source and conversation. Bump when parse behavior changes. */
export const PARSER_VERSION: Record<Exclude<ProviderId, "gemini">, string> = {
  chatgpt: "chatgpt@2",
  claude: "claude@2",
  grok: "grok@2",
  perplexity: "perplexity@1",
  generic: "generic@2",
  demo: "demo@1",
  sift: "sift@1",
};

export const SUPPORTED_PROVIDERS: ProviderId[] = ["grok", "chatgpt", "claude", "perplexity", "generic", "demo", "sift"];

export function parserVersionFor(provider: ProviderId): string {
  if (provider === "gemini") return "gemini@unsupported";
  return PARSER_VERSION[provider];
}
