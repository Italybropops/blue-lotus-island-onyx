import { create } from "zustand";
import { persist } from "zustand/middleware";
import { analyzeChats, applyInferredCategories } from "./analyze";
import { DEMO_CHATS } from "./demo";
import { newId } from "./parse";
import { bucketFor } from "./triage";
import type { AiAnalysis, Analysis, Category, Chat, CleanupTab, TriageBucket } from "./types";
import type { ImportBundle } from "@/lib/sift/types";
import { chatsToCanonical } from "@/lib/sift/providers/canonical";
import { addRelationship, insertImport, setSetting, updateConversation } from "@/lib/sift/repo";
import { persistNow, restoreArchiveFromBytes, snapshotBackup } from "@/lib/sift/sqlite";
import { validateArchive } from "@/lib/sift/validate";
import { loadVisibleLibrary, openArchive } from "@/lib/sift/hydrate";
import { statusToState } from "@/lib/sift/view";
import type { ArchivePeek } from "@/lib/sift/types";

export type AppView = "library" | "insights" | "cleanup" | "import" | "settings";

export interface ImportReport {
  inserted: number;
  exactDuplicates: number;
  skipped: number;
  failed: number;
  warnings: string[];
  replacedArchive: boolean;
  rawRetained: boolean;
  persistOk: boolean;
  persistError?: string;
}

interface ChatState {
  chats: Chat[];
  usingDemo: boolean;
  selectedId: string | null;
  view: AppView;
  query: string;
  categoryFilter: Category | "All";
  flagFilter: "all" | "duplicates" | "clutter" | "pinned" | "archived";
  cleanupTab: CleanupTab;
  analysis: Analysis | null;
  aiAnalysis: AiAnalysis | null;
  grokChecks: Record<string, boolean>;
  triage: Record<string, TriageBucket>;
  hydrated: boolean;
  archiveError: string | null;
  lastImport: ImportReport | null;
  persistError: string | null;
  pendingRestore: (ArchivePeek & { bytes: Uint8Array }) | null;
  setHydrated: (v: boolean) => void;
  setView: (view: AppView) => void;
  setQuery: (query: string) => void;
  setCategoryFilter: (c: Category | "All") => void;
  setFlagFilter: (f: ChatState["flagFilter"]) => void;
  setCleanupTab: (tab: CleanupTab) => void;
  select: (id: string | null) => void;
  refreshAnalysis: () => void;
  reloadFromArchive: () => Promise<void>;
  importChats: (incoming: Chat[], mode: "append" | "replace") => void;
  importBundles: (bundles: ImportBundle[], mode: "append" | "replace") => Promise<ImportReport>;
  confirmRestore: () => Promise<ImportReport>;
  cancelRestore: () => void;
  loadDemo: () => void;
  clearLibrary: () => void;
  removeChats: (ids: string[]) => void;
  restoreChat: (id: string) => void;
  mergeChats: (ids: string[], title?: string) => void;
  recategorize: (id: string, category: Category) => void;
  togglePin: (id: string) => void;
  pinWorkingSet: () => void;
  setArchived: (ids: string[], archived: boolean) => void;
  applyRenames: (ids?: string[]) => void;
  setAiAnalysis: (ai: AiAnalysis | null) => void;
  applyAiSummaries: () => void;
  patchSummary: (id: string, summary: string) => void;
  toggleGrokCheck: (key: string) => void;
  setTriage: (id: string, bucket: TriageBucket) => void;
  applyTriagePlan: () => void;
}

function normalize(chat: Chat): Chat {
  return {
    ...chat,
    archived: Boolean(chat.archived),
    pinned: Boolean(chat.pinned),
    status: chat.status ?? "active",
    summary: chat.summary || "",
  };
}

function withAnalysis(chats: Chat[]): Pick<ChatState, "chats" | "analysis"> {
  const next = applyInferredCategories(chats.map(normalize));
  return { chats: next, analysis: analyzeChats(next) };
}

function writeState(chat: Chat): void {
  void updateConversation(chat.id, {
    title: chat.title,
    category: chat.category,
    pinned: chat.pinned,
    state: statusToState(chat),
    summary: chat.summary,
  });
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: DEMO_CHATS,
      usingDemo: true,
      selectedId: DEMO_CHATS[0]?.id ?? null,
      view: "insights",
      query: "",
      categoryFilter: "All",
      flagFilter: "all",
      cleanupTab: "delete",
      analysis: analyzeChats(DEMO_CHATS),
      aiAnalysis: null,
      grokChecks: {},
      triage: {},
      hydrated: false,
      archiveError: null,
      lastImport: null,
      persistError: null,
      pendingRestore: null,
      setHydrated: (v) => set({ hydrated: v }),
      setView: (view) => set({ view }),
      setQuery: (query) => set({ query }),
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      setFlagFilter: (flagFilter) => set({ flagFilter }),
      setCleanupTab: (cleanupTab) => set({ cleanupTab }),
      select: (selectedId) => set({ selectedId }),
      refreshAnalysis: () => set(withAnalysis(get().chats)),
      reloadFromArchive: async () => {
        const loaded = await loadVisibleLibrary();
        set({
          ...withAnalysis(loaded.chats),
          usingDemo: loaded.usingDemo,
          selectedId: loaded.chats.find((c) => c.id === get().selectedId)?.id ?? loaded.chats[0]?.id ?? null,
        });
      },
      importChats: (incoming, mode) => {
        if (!incoming.length) return;
        void get().importBundles(
          [
            {
              provider: "generic",
              label: "Pasted text",
              conversations: chatsToCanonical(incoming, "pending", "generic"),
              warnings: [],
              skipped: [],
              failed: [],
              parser: "generic",
              parserVersion: "generic@2",
            },
          ],
          mode,
        );
      },
      importBundles: async (bundles, mode) => {
        const restore = bundles.find((b) => b.restore);
        if (restore?.restore) {
          set({ pendingRestore: restore.restore });
          return {
            inserted: 0,
            exactDuplicates: 0,
            skipped: 0,
            failed: 0,
            warnings: restore.warnings,
            replacedArchive: false,
            rawRetained: false,
            persistOk: true,
          };
        }
        if (mode === "replace" && !get().usingDemo) {
          for (const chat of get().chats.filter((c) => c.status === "active")) {
            await updateConversation(chat.id, { state: "archived" });
          }
        }
        await setSetting("usingDemo", false);
        let inserted = 0;
        let exactDuplicates = 0;
        let skipped = 0;
        let failed = 0;
        let rawRetained = true;
        let persistOk = true;
        let persistError: string | undefined;
        const warnings: string[] = [];
        for (const bundle of bundles) {
          warnings.push(...bundle.warnings);
          skipped += bundle.skipped?.length ?? 0;
          failed += bundle.failed?.length ?? 0;
          if (!bundle.conversations.length && !bundle.skipped?.length) continue;
          const result = await insertImport(bundle);
          inserted += result.inserted;
          exactDuplicates += result.exactDuplicateLinks;
          skipped += result.skipped;
          failed += result.failed;
          if (!result.rawRetained) rawRetained = false;
          if (!result.persistOk) {
            persistOk = false;
            persistError = result.persistError;
          }
          if (!result.validationOk) warnings.push("Integrity check found issues after this import.");
        }
        const saved = await persistNow();
        if (!saved.ok) {
          persistOk = false;
          persistError = saved.error;
        }
        const loaded = await loadVisibleLibrary();
        const report: ImportReport = {
          inserted,
          exactDuplicates,
          skipped,
          failed,
          warnings,
          replacedArchive: false,
          rawRetained,
          persistOk,
          persistError,
        };
        set({
          ...withAnalysis(loaded.chats),
          usingDemo: false,
          selectedId: loaded.chats[0]?.id ?? null,
          view: "insights",
          aiAnalysis: null,
          triage: mode === "replace" ? {} : get().triage,
          lastImport: report,
          archiveError: persistOk ? null : persistError ?? "Archive did not save.",
          persistError: persistOk ? null : persistError ?? "Archive did not save.",
        });
        return report;
      },
      cancelRestore: () => set({ pendingRestore: null }),
      confirmRestore: async () => {
        const pending = get().pendingRestore;
        if (!pending) {
          throw new Error("Nothing to restore.");
        }
        await snapshotBackup();
        const { backupStamp } = await restoreArchiveFromBytes(pending.bytes);
        const validation = await validateArchive();
        if (!validation.ok) {
          throw new Error(
            `Restored file failed integrity checks (${validation.issues.map((i) => i.code).join(", ")}). ${backupStamp ? "A backup snapshot was kept in this browser." : ""}`,
          );
        }
        await setSetting("usingDemo", false);
        const loaded = await loadVisibleLibrary();
        const report: ImportReport = {
          inserted: loaded.chats.length,
          exactDuplicates: 0,
          skipped: 0,
          failed: 0,
          warnings: [`Restored ${pending.filename}. Previous archive snapshot: ${backupStamp ?? "none"}. Merge is not implemented.`],
          replacedArchive: true,
          rawRetained: true,
          persistOk: true,
        };
        set({
          ...withAnalysis(loaded.chats),
          usingDemo: false,
          selectedId: loaded.chats[0]?.id ?? null,
          view: "insights",
          lastImport: report,
          pendingRestore: null,
          archiveError: null,
          persistError: null,
        });
        return report;
      },
      loadDemo: () => {
        void (async () => {
          await setSetting("usingDemo", true);
          const loaded = await loadVisibleLibrary();
          if (!loaded.chats.length) {
            await insertImport({
              provider: "demo",
              label: "Sample library",
              conversations: chatsToCanonical(DEMO_CHATS, "pending", "demo"),
              warnings: [],
              skipped: [],
              failed: [],
              parser: "demo",
              parserVersion: "demo@1",
            });
            await persistNow();
            const again = await loadVisibleLibrary();
            set({
              ...withAnalysis(again.chats),
              usingDemo: true,
              selectedId: again.chats[0]?.id ?? null,
              view: "insights",
              aiAnalysis: null,
              grokChecks: {},
              triage: {},
            });
            return;
          }
          set({
            ...withAnalysis(loaded.chats),
            usingDemo: true,
            selectedId: loaded.chats[0]?.id ?? null,
            view: "insights",
            aiAnalysis: null,
            grokChecks: {},
            triage: {},
          });
        })();
      },
      clearLibrary: () => {
        const chats = get().chats;
        for (const chat of chats) {
          if (chat.status === "active") writeState({ ...chat, status: "removed", archived: false });
        }
        void setSetting("usingDemo", false);
        set({
          chats: chats.map((c) => (c.status === "active" ? { ...c, status: "removed" as const } : c)),
          analysis: analyzeChats(chats.map((c) => (c.status === "active" ? { ...c, status: "removed" as const } : c))),
          usingDemo: false,
          selectedId: null,
          aiAnalysis: null,
          grokChecks: {},
          triage: {},
        });
      },
      removeChats: (ids) => {
        const setIds = new Set(ids);
        const chats = get().chats.map((c) => {
          if (!setIds.has(c.id)) return c;
          const next = { ...c, status: "removed" as const };
          writeState(next);
          return next;
        });
        const selectedId = setIds.has(get().selectedId ?? "")
          ? (chats.find((c) => c.status === "active")?.id ?? null)
          : get().selectedId;
        const triage = { ...get().triage };
        for (const id of ids) delete triage[id];
        set({ ...withAnalysis(chats), selectedId, triage });
      },
      restoreChat: (id) => {
        const chats = get().chats.map((c) => {
          if (c.id !== id || c.status !== "removed") return c;
          const next = { ...c, status: "active" as const, archived: false };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      mergeChats: (ids, title) => {
        const setIds = new Set(ids);
        const sources = get()
          .chats.filter((c) => setIds.has(c.id) && c.status === "active")
          .sort((a, b) => new Date(a.createdAt || a.importedAt || 0).getTime() - new Date(b.createdAt || b.importedAt || 0).getTime());
        if (sources.length < 2) return;
        const messages = sources.flatMap((c) => c.messages);
        const merged: Chat = {
          id: newId("c"),
          title: title?.trim() || `Merged · ${sources[0].title}`,
          createdAt: sources[0].createdAt,
          updatedAt: new Date().toISOString(),
          messages,
          source: "merged",
          status: "active",
          category: sources[0].category,
          pinned: sources.some((c) => c.pinned),
          archived: false,
          summary: sources.map((c) => c.summary).filter(Boolean).join(" · "),
          mergedFrom: sources.map((c) => c.id),
        };
        const chats = [merged, ...get().chats.map((c) => (setIds.has(c.id) ? { ...c, status: "merged" as const } : c))];
        const triage = { ...get().triage };
        for (const id of ids) delete triage[id];
        set({ ...withAnalysis(chats), selectedId: merged.id, view: "library", triage });
        void (async () => {
          for (const src of sources) {
            await updateConversation(src.id, { state: "merged" });
            await addRelationship({
              kind: "merged_from",
              fromId: merged.id,
              toId: src.id,
              reason: "User merged these threads. Originals are kept as merged.",
            });
          }
          await insertImport({
            provider: "sift",
            label: "Merged conversation",
            conversations: chatsToCanonical([merged], "pending", "sift"),
            warnings: [],
            skipped: [],
            failed: [],
            parser: "sift",
            parserVersion: "sift@1",
          });
          await persistNow();
        })();
      },
      recategorize: (id, category) => {
        const chats = get().chats.map((c) => {
          if (c.id !== id) return c;
          const next = { ...c, category };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      togglePin: (id) => {
        const chats = get().chats.map((c) => {
          if (c.id !== id) return c;
          const next = { ...c, pinned: !c.pinned, archived: c.pinned ? c.archived : false };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      pinWorkingSet: () => {
        const ids = new Set(get().analysis?.workingSetIds ?? []);
        if (!ids.size) return;
        const chats = get().chats.map((c) => {
          if (!ids.has(c.id)) return c;
          const next = { ...c, pinned: true, archived: false };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      setArchived: (ids, archived) => {
        const setIds = new Set(ids);
        const chats = get().chats.map((c) => {
          if (!setIds.has(c.id)) return c;
          const next = { ...c, archived, pinned: archived ? false : c.pinned };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      applyRenames: (ids) => {
        const suggestions = get().analysis?.renameSuggestions ?? [];
        const want = ids ? new Set(ids) : new Set(suggestions.map((s) => s.chatId));
        const map = new Map(suggestions.filter((s) => want.has(s.chatId)).map((s) => [s.chatId, s.suggested] as const));
        if (!map.size) return;
        const chats = get().chats.map((c) => {
          if (!map.has(c.id)) return c;
          const next = { ...c, title: map.get(c.id)! };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      setAiAnalysis: (aiAnalysis) => set({ aiAnalysis }),
      applyAiSummaries: () => {
        const ai = get().aiAnalysis;
        if (!ai) return;
        const sum = new Map(ai.summaries.map((s) => [s.chatId, s.summary]));
        const cat = new Map(ai.recategorizations.map((s) => [s.chatId, s.category]));
        const chats = get().chats.map((c) => {
          const next = {
            ...c,
            summary: sum.get(c.id) ?? c.summary,
            category: cat.get(c.id) ?? c.category,
          };
          if (next.summary !== c.summary || next.category !== c.category) writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      patchSummary: (id, summary) => {
        const chats = get().chats.map((c) => {
          if (c.id !== id) return c;
          const next = { ...c, summary };
          writeState(next);
          return next;
        });
        set(withAnalysis(chats));
      },
      toggleGrokCheck: (key) => set({ grokChecks: { ...get().grokChecks, [key]: !get().grokChecks[key] } }),
      setTriage: (id, bucket) => set({ triage: { ...get().triage, [id]: bucket } }),
      applyTriagePlan: () => {
        const { chats, analysis, triage } = get();
        const next = chats.map((c) => {
          if (c.status !== "active") return c;
          const bucket = bucketFor(c, analysis, triage);
          const updated =
            bucket === "drop"
              ? { ...c, status: "removed" as const }
              : bucket === "keep"
                ? { ...c, pinned: true, archived: false }
                : { ...c, archived: true, pinned: false };
          writeState(updated);
          return updated;
        });
        const selectedId =
          next.find((c) => c.id === get().selectedId && c.status === "active")?.id ??
          next.find((c) => c.status === "active")?.id ??
          null;
        set({ ...withAnalysis(next), triage: {}, selectedId });
      },
    }),
    {
      name: "sift-ui-v2",
      partialize: (s) => ({
        grokChecks: s.grokChecks,
        selectedId: s.selectedId,
        triage: s.triage,
        view: s.view === "settings" ? "insights" : s.view,
      }),
      skipHydration: true,
    },
  ),
);

export async function hydrateArchive(): Promise<void> {
  try {
    const loaded = await openArchive();
    useChatStore.setState({
      ...withAnalysis(loaded.chats),
      usingDemo: loaded.usingDemo,
      selectedId: loaded.chats[0]?.id ?? null,
      hydrated: true,
      archiveError: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open the local SQLite archive.";
    useChatStore.setState({
      ...withAnalysis(DEMO_CHATS),
      usingDemo: true,
      hydrated: true,
      archiveError: message,
    });
  }
}

export function activeChats(chats: Chat[]): Chat[] {
  return chats.filter((c) => c.status === "active");
}
