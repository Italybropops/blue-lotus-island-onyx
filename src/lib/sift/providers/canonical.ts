import type { Chat } from "@/lib/chats/types";
import { newId } from "../ids";
import { parserVersionFor } from "../parsers";
import type { CanonicalConversation, CanonicalMessage, ProviderId } from "../types";

export function chatsToCanonical(chats: Chat[], sourceId: string, provider: ProviderId): CanonicalConversation[] {
  const parserVersion = parserVersionFor(provider);
  return chats.map((chat) => {
    const messages: CanonicalMessage[] = chat.messages.map((m, i) => ({
      id: m.id || newId("m"),
      sourceMessageId: m.sourceMessageId,
      parentSourceId: m.parentSourceId,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      sortIndex: i,
      isOnCurrentPath: m.onCurrentPath !== false,
      contentSha256: "",
      attachments: (m.attachments ?? []).map((a) => ({
        id: a.id,
        kind: "file" as const,
        filename: a.filename,
        mime: a.mime,
        url: a.url,
        bytesLen: a.bytesLen,
        availability: a.availability,
        metadata: {},
      })),
      metadata: {},
    }));
    return {
      id: chat.id || newId("c"),
      sourceId,
      sourceConversationId: chat.sourceConversationId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      importedAt: chat.importedAt,
      category: chat.category,
      pinned: chat.pinned,
      state: "active" as const,
      summary: chat.summary,
      contentSha256: "",
      processingStage: "normalized" as const,
      parser: provider,
      parserVersion,
      currentSourceNodeId: chat.currentSourceNodeId,
      messageCount: messages.length,
      charCount: messages.reduce((n, m) => n + m.content.length, 0),
      messages,
      metadata: { provider, demo: chat.source === "demo" },
    };
  });
}