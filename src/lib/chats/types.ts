export const CATEGORIES = [
  "Code",
  "Writing",
  "Research",
  "Creative",
  "Travel",
  "Lifestyle",
  "Learning",
  "Planning",
  "Support",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type ChatStatus = "active" | "removed" | "merged";
export type ChatSource = "demo" | "import" | "merged";
export type TriageBucket = "keep" | "park" | "drop";

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  source: ChatSource;
  status: ChatStatus;
  category: Category;
  pinned: boolean;
  archived: boolean;
  summary: string;
  mergedFrom?: string[];
  contentSha256?: string;
  provider?: string;
  sourceId?: string;
}

export interface DuplicateGroup {
  id: string;
  chatIds: string[];
  score: number;
  reason: string;
  keepId: string;
  kind?: "exact" | "near";
}

export interface MergeSuggestion {
  id: string;
  chatIds: string[];
  score: number;
  title: string;
  reason: string;
}

export interface DeleteSuggestion {
  chatId: string;
  reason: string;
  severity: "clutter" | "duplicate" | "stale";
}

export interface OrgSuggestion {
  id: string;
  kind: "folder" | "naming" | "hybrid" | "pin";
  title: string;
  detail: string;
  chatIds: string[];
}

export interface RepeatTopic {
  label: string;
  chatIds: string[];
  category: Category;
}

export interface RenameSuggestion {
  chatId: string;
  suggested: string;
  reason: string;
}

export interface Analysis {
  generatedAt: string;
  duplicateGroups: DuplicateGroup[];
  mergeSuggestions: MergeSuggestion[];
  deleteSuggestions: DeleteSuggestion[];
  orgSuggestions: OrgSuggestion[];
  renameSuggestions: RenameSuggestion[];
  repeatTopics: RepeatTopic[];
  clutterIds: string[];
  workingSetIds: string[];
  archiveIds: string[];
}

export interface AiInsight {
  chatId?: string;
  title: string;
  body: string;
}

export interface AiAnalysis {
  generatedAt: string;
  overview: string;
  recategorizations: { chatId: string; category: Category; reason: string }[];
  summaries: { chatId: string; summary: string }[];
  extraDeletes: { chatId: string; reason: string }[];
  extraMerges: { chatIds: string[]; reason: string; title: string }[];
  hybridPlan: string[];
  notes: AiInsight[];
}

export type CleanupTab = "delete" | "merge" | "organize" | "grok";
export type ImportMode = "auto" | "titles" | "transcripts";
