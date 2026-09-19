import type { CanonicalMessage } from "./types";

/** Strip volatile whitespace so two exports of the same chat hash equal. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

export function messageHashInput(role: string, content: string): string {
  return `${role}\n${normalizeText(content)}`;
}

export function conversationHashInput(
  messages: Pick<CanonicalMessage, "role" | "content">[],
): string {
  return messages.map((m) => messageHashInput(m.role, m.content)).join("\n\u001e\n");
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

export async function hashMessages(
  messages: Pick<CanonicalMessage, "role" | "content">[],
): Promise<{ conversation: string; messages: string[] }> {
  const messageHashes = await Promise.all(
    messages.map((m) => sha256Hex(messageHashInput(m.role, m.content))),
  );
  const conversation = await sha256Hex(conversationHashInput(messages));
  return { conversation, messages: messageHashes };
}
