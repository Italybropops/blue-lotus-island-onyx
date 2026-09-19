import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, Wordmark } from "@/components/app-shell";
import { CleanupView } from "@/components/cleanup-view";
import { ImportView } from "@/components/import-view";
import { InsightsView } from "@/components/insights-view";
import { LibraryView } from "@/components/library-view";
import { SettingsView } from "@/components/settings-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deepAnalyze, type CompactChat } from "@/lib/ai/deep-analyze";
import { flagsFor } from "@/lib/chats/format";
import { userText } from "@/lib/chats/parse";
import { activeChats, hydrateArchive, useChatStore } from "@/lib/chats/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const view = useChatStore((s) => s.view);
  const hydrated = useChatStore((s) => s.hydrated);

  useEffect(() => {
    const unsub = useChatStore.persist.onFinishHydration(() => undefined);
    void useChatStore.persist.rehydrate();
    void hydrateArchive();
    const timeout = window.setTimeout(() => {
      if (!useChatStore.getState().hydrated) useChatStore.getState().setHydrated(true);
    }, 4000);
    return () => {
      unsub();
      window.clearTimeout(timeout);
    };
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground">
        <Wordmark />
        <p className="text-sm text-muted-foreground">Opening local archive…</p>
      </div>
    );
  }

  return (
    <AppShell actions={<AskExternalAiButton />}>
      {view === "insights" && <InsightsView />}
      {view === "library" && <LibraryView />}
      {view === "cleanup" && <CleanupView />}
      {view === "import" && <ImportView />}
      {view === "settings" && <SettingsView />}
    </AppShell>
  );
}

function AskExternalAiButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const chats = useChatStore((s) => s.chats);
  const analysis = useChatStore((s) => s.analysis);
  const setAi = useChatStore((s) => s.setAiAnalysis);
  const applyAi = useChatStore((s) => s.applyAiSummaries);
  const setView = useChatStore((s) => s.setView);

  async function run() {
    const active = activeChats(chats);
    if (!active.length) {
      toast.message("Import some chats first.");
      return;
    }
    setBusy(true);
    setOpen(false);
    try {
      const compact: CompactChat[] = active.slice(0, 40).map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category,
        createdAt: c.createdAt,
        messageCount: c.messages.length,
        userChars: userText(c).length,
        firstUser: c.messages.find((m) => m.role === "user")?.content ?? "",
        flags: flagsFor(c, analysis),
      }));
      const result = await deepAnalyze({ data: { chats: compact } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAi(result.analysis);
      applyAi();
      setView("insights");
      toast.success("External model finished. Compact excerpts were sent off-device.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deep analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={busy} size="sm" aria-busy={busy} variant="outline">
        <Sparkles className="size-4" strokeWidth={1.75} />
        {busy ? "Asking…" : "External AI"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send excerpts off this device?</DialogTitle>
            <DialogDescription>
              Local sorting already ran here. This optional pass uses xAI (Grok). It sends titles and short excerpts
              for at most 40 chats — not your SQLite archive, and not full long threads. Core Sift does not need this.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Stay local
            </Button>
            <Button onClick={() => void run()}>Send excerpts</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}