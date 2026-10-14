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

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type AttachmentAvailability = "local" | "reference" | "unavailable" | "unsupported";

export type SourceStatus = "complete" | "partial" | "failed" | "raw_not_retained";

export interface AttachmentRecord {
  id: string;
  sourceAttachmentId?: string;
  messageId?: string;
  conversationId?: string;
  kind: "pdf" | "image" | "url" | "file" | "audio" | "other";
  filename?: string;
  mime?: string;
  sha256?: string;
  url?: string;
  bytesLen?: number;
  availability: AttachmentAvailability;
  localKey?: string;
  metadata: Record<string, unknown>;
}

export interface CanonicalMessage {
  id: string;
  sourceMessageId?: string;
  parentSourceId?: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  sortIndex: number;
  isOnCurrentPath: boolean;
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
  importedAt?: string;
  category: string;
  pinned: boolean;
  state: ConversationState;
  summary: string;
  contentSha256: string;
  processingStage: ProcessingStage;
  parser?: string;
  parserVersion?: string;
  currentSourceNodeId?: string;
  messageCount: number;
  charCount: number;
  messages: CanonicalMessage[];
  metadata: Record<string, unknown>;
}

export interface ParseSkip {
  reason: string;
  key?: string;
  index?: number;
}

export interface SourceRecord {
  id: string;
  provider: ProviderId;
  label: string;
  importedAt: string;
  rawFilename?: string;
  rawSha256?: string;
  byteLength?: number;
  mime?: string;
  parser: string;
  parserVersion: string;
  status: SourceStatus;
  rawRetained: boolean;
  rawBackend?: string;
  conversationCount: number;
  messageCount: number;
  attachmentCount: number;
  skippedCount: number;
  failedCount: number;
  notes?: string;
  manifest: Record<string, unknown>;
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

export interface ArchivePeek {
  conversations: number;
  messages: number;
  sources: number;
  schemaVersion: string;
  filename: string;
  byteLength: number;
}

export interface ImportBundle {
  provider: ProviderId;
  label: string;
  filename?: string;
  mime?: string;
  conversations: CanonicalConversation[];
  warnings: string[];
  skipped: ParseSkip[];
  failed: ParseSkip[];
  parser: string;
  parserVersion: string;
  expectedConversationCount?: number;
  rawBytes?: Uint8Array;
  restore?: ArchivePeek & { bytes: Uint8Array };
}

export interface IntegrityIssue {
  code: string;
  detail: string;
}

export interface IntegrityReport {
  ok: boolean;
  foreignKeysOn: boolean;
  issues: IntegrityIssue[];
  conversations: number;
  messages: number;
  attachments: number;
  sources: number;
  orphans: number;
}

export interface ImportManifest {
  source_id: string;
  provider: ProviderId;
  filename?: string;
  original_sha256?: string;
  byte_size?: number;
  imported_at: string;
  parser: string;
  parser_version: string;
  conversation_count: number;
  message_count: number;
  attachment_count: number;
  skipped_count: number;
  failed_count: number;
  status: SourceStatus;
  raw_retained: boolean;
  raw_backend?: string;
  warnings: string[];
}
