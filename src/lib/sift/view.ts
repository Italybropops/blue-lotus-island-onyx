import type { Chat, ChatStatus, Message, MessageAttachment } from "@/lib/chats/types";
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
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    sourceMessageId: m.sourceMessageId,
    parentSourceId: m.parentSourceId,
    onCurrentPath: m.isOnCurrentPath,
    attachments: m.attachments.map(
      (a): MessageAttachment => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        availability: a.availability,
        url: a.url,
        bytesLen: a.bytesLen,
      }),
    ),
  }));
  const visible = messages.filter((m) => m.onCurrentPath !== false && (m.role === "user" || m.role === "assistant"));
  const forSummary = visible.length ? visible : messages;
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    importedAt: conv.importedAt,
    messages,
    source: conv.metadata.demo === true ? "demo" : conv.metadata.merged === true ? "merged" : "import",
    status: stateToStatus(conv.state),
    category: (conv.category as Chat["category"]) || "Other",
    pinned: conv.pinned,
    archived: conv.state === "archived",
    summary: conv.summary || summaryFrom(forSummary),
    mergedFrom: Array.isArray(conv.metadata.mergedFrom) ? (conv.metadata.mergedFrom as string[]) : undefined,
    contentSha256: conv.contentSha256,
    provider: String(conv.metadata.provider ?? conv.parser ?? ""),
    sourceId: conv.sourceId,
    sourceConversationId: conv.sourceConversationId,
    parser: conv.parser,
    parserVersion: conv.parserVersion,
    currentSourceNodeId: conv.currentSourceNodeId,
  };
}

export function statusToState(chat: Chat): ConversationState {
  if (chat.status === "merged") return "merged";
  if (chat.status === "removed") return "low_value";
  if (chat.archived) return "archived";
  return "active";
}

export function transcriptMessages(chat: Chat): Message[] {
  const onPath = chat.messages.filter((m) => m.onCurrentPath !== false);
  const spoken = onPath.filter((m) => m.role === "user" || m.role === "assistant");
  return spoken.length ? spoken : chat.messages.filter((m) => m.role === "user" || m.role === "assistant");
}
