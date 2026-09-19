export type ProviderId =
  | "grok"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "perplexity"
  | "generic"
  | "demo"
  | "sift";

export type ConversationState =
  | "active"
  | "archived"
  | "merged"
  | "superseded"
  | "low_value"
  | "reviewed";

export type ProcessingStage =
  | "imported"
  | "normalized"
  | "hashed"
  | "deduplicated"
  | "classified"
  | "extracted"
  | "reviewed";

export type RelationshipKind =
  | "exact_duplicate"
  | "near_duplicate"
  | "same_topic"
  | "merged_from"
  | "supersedes"
  | "related";

export type KnowledgeKind =
  | "fact"
  | "preference"
  | "goal"
  | "decision"
  | "idea"
  | "question"
  | "action_item"
  | "project"
  | "entity"
  | "lesson"
  | "contradiction"
  | "unresolved";

export type KnowledgeSourceType =
  | "user_stated"
  | "ai_inferred"
  | "ai_recommended"
  | "external_fact"
  | "uncertain";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface AttachmentRecord {
  id: string;
  messageId?: string;
  conversationId?: string;
  kind: "pdf" | "image" | "url" | "file" | "audio" | "other";
  filename?: string;
  mime?: string;
  sha256?: string;
  url?: string;
  bytesLen?: number;
  metadata: Record<string, unknown>;
}

export interface CanonicalMessage {
  id: string;
  sourceMessageId?: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  sortIndex: number;
  contentSha256: string;
  attachments: AttachmentRecord[];
  metadata: Record<string, unknown>;
}

export interface CanonicalConversation {
  id: string;
  sourceId: string;
  sourceConversationId?: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  category: string;
  pinned: boolean;
  state: ConversationState;
  summary: string;
  contentSha256: string;
  processingStage: ProcessingStage;
  messageCount: number;
  charCount: number;
  messages: CanonicalMessage[];
  metadata: Record<string, unknown>;
}

export interface SourceRecord {
  id: string;
  provider: ProviderId;
  label: string;
  importedAt: string;
  rawFilename?: string;
  rawSha256?: string;
  notes?: string;
  metadata: Record<string, unknown>;
}

export interface RelationshipRecord {
  id: string;
  kind: RelationshipKind;
  fromId: string;
  toId: string;
  score?: number;
  reason?: string;
  createdAt: string;
}

export interface ImportBundle {
  provider: ProviderId;
  label: string;
  filename?: string;
  conversations: CanonicalConversation[];
  warnings: string[];
}
