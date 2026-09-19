import type { Chat } from "@/lib/chats/types";
import { newId } from "../ids";
import type { CanonicalConversation, CanonicalMessage, ProviderId } from "../types";

export function chatsToCanonical(chats: Chat[], sourceId: string, provider: ProviderId): CanonicalConversation[] {
  return chats.map((chat) => {
    const messages: CanonicalMessage[] = chat.messages.map((m, i) => ({
      id: m.id || newId("m"),
      role: m.role,
      content: m.content,
      sortIndex: i,
      contentSha256: "",
      attachments: [],
      metadata: {},
    }));
    return {
      id: chat.id || newId("c"),
      sourceId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      category: chat.category,
      pinned: chat.pinned,
      state: "active",
      summary: chat.summary,
      contentSha256: "",
      processingStage: "normalized",
      messageCount: messages.length,
      charCount: messages.reduce((n, m) => n + m.content.length, 0),
      messages,
      metadata: { provider, demo: chat.source === "demo" },
    };
  });
}
