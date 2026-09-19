import type { Chat, ChatStatus, Message } from "@/lib/chats/types";
import { summaryFrom } from "@/lib/chats/parse";
import type { CanonicalConversation, ConversationState } from "./types";

function stateToStatus(state: ConversationState): ChatStatus {
  if (state === "merged" || state === "superseded") return "merged";
  if (state === "low_value") return "removed";
  return "active";
}

export function toViewChat(conv: CanonicalConversation): Chat {
  const messages: Message[] = conv.messages.map((m) => ({
    id: m.id,
    role: m.role === "assistant" || m.role === "tool" ? "assistant" : "user",
    content: m.content,
  }));
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt ?? new Date().toISOString(),
    updatedAt: conv.updatedAt ?? conv.createdAt ?? new Date().toISOString(),
    messages,
    source: conv.metadata.demo === true ? "demo" : conv.metadata.merged === true ? "merged" : "import",
    status: stateToStatus(conv.state),
    category: (conv.category as Chat["category"]) || "Other",
    pinned: conv.pinned,
    archived: conv.state === "archived",
    summary: conv.summary || summaryFrom(messages),
    mergedFrom: Array.isArray(conv.metadata.mergedFrom)
      ? (conv.metadata.mergedFrom as string[])
      : undefined,
    contentSha256: conv.contentSha256,
    provider: String(conv.metadata.provider ?? ""),
    sourceId: conv.sourceId,
  };
}

export function statusToState(chat: Chat): ConversationState {
  if (chat.status === "merged") return "merged";
  if (chat.status === "removed") return "low_value";
  if (chat.archived) return "archived";
  return "active";
}
