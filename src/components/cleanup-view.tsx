import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatChecklist } from "@/lib/chats/analyze";
import { downloadText } from "@/lib/chats/format";
import { activeChats, useChatStore } from "@/lib/chats/store";
import type { CleanupTab } from "@/lib/chats/types";
import { cn } from "@/lib/utils";

export function CleanupView() {
  const chats = useChatStore((s) => s.chats);
  const analysis = useChatStore((s) => s.analysis);
  const ai = useChatStore((s) => s.aiAnalysis);
  const removeChats = useChatStore((s) => s.removeChats);
  const mergeChats = useChatStore((s) => s.mergeChats);
  const restoreChat = useChatStore((s) => s.restoreChat);
  const grokChecks = useChatStore((s) => s.grokChecks);
  const toggleGrokCheck = useChatStore((s) => s.toggleGrokCheck);
  const pinWorkingSet = useChatStore((s) => s.pinWorkingSet);
  const applyRenames = useChatStore((s) => s.applyRenames);
  const cleanupTab = useChatStore((s) => s.cleanupTab);
  const setCleanupTab = useChatStore((s) => s.setCleanupTab);

  const byId = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);
  const active = activeChats(chats);
  const removed = chats.filter((c) => c.status === "removed");

  const [deleteSel, setDeleteSel] = useState<Record<string, boolean>>({});
  const [mergeSel, setMergeSel] = useState<Record<string, boolean>>({});
  const [renameSel, setRenameSel] = useState<Record<string, boolean>>({});

  const deletes = analysis?.deleteSuggestions ?? [];
  const merges = analysis?.mergeSuggestions ?? [];
  const renames = analysis?.renameSuggestions ?? [];

  const extraDeletes = (ai?.extraDeletes ?? []).filter((d) => !deletes.some((x) => x.chatId === d.chatId));

  function toggle(map: Record<string, boolean>, set: (v: Record<string, boolean>) => void, id: string) {
    set({ ...map, [id]: !map[id] });
  }

  function applyDeletes() {
    const ids = Object.entries(deleteSel)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!ids.length) {
      toast.message("Select at least one chat to remove from Sift.");
      return;
    }
    removeChats(ids);
    toast.success(`Removed ${ids.length} from Sift. Still delete them in Grok.`);
    setDeleteSel({});
  }

  function applyMerges() {
    const groups = merges.filter((m) => mergeSel[m.id]);
    if (!groups.length) {
      toast.message("Select a merge group first.");
      return;
    }
    for (const g of groups) mergeChats(g.chatIds, g.title);
    toast.success("Merged locally. In Grok, keep one thread and delete the extras.");
    setMergeSel({});
  }

  function copyTitles(ids: string[]) {
    const titles = ids
      .map((id) => byId.get(id)?.title)
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard.writeText(titles);
    toast.success("Titles copied — search them in Grok’s sidebar.");
  }

  function exportPlan() {
    if (!analysis) return;
    downloadText("sift-grok-cleanup.md", formatChecklist(chats, analysis), "text/markdown");
    toast.success("Checklist downloaded.");
  }

  const grokItems = deletes.length + merges.length;
  const grokDone = Object.values(grokChecks).filter(Boolean).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 lg:px-8">
      <header>
        <h1 className="font-display text-4xl leading-tight tracking-tight">Cleanup plan</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Sift can merge and hide chats in this library. Deleting on grok.com is still on you — use the checklist,
          then tick items as you finish them in the browser or the Grok Mac app.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={exportPlan} disabled={!analysis}>
            Download checklist
          </Button>
          <Button variant="outline" onClick={() => copyTitles(deletes.map((d) => d.chatId))} disabled={!deletes.length}>
            Copy delete titles
          </Button>
        </div>
      </header>

      <Tabs value={cleanupTab} onValueChange={(v) => setCleanupTab(v as CleanupTab)}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="delete">Hide</TabsTrigger>
          <TabsTrigger value="merge">Merge</TabsTrigger>
          <TabsTrigger value="organize">Organize</TabsTrigger>
          <TabsTrigger value="grok">Do this in Grok</TabsTrigger>
        </TabsList>

        <TabsContent value="delete">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next: Record<string, boolean> = {};
                for (const d of deletes) if (d.severity === "clutter") next[d.chatId] = true;
                setDeleteSel(next);
              }}
            >
              Select clutter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next: Record<string, boolean> = {};
                for (const d of deletes) next[d.chatId] = true;
                setDeleteSel(next);
              }}
            >
              Select all
            </Button>
          </div>
          <ul className="space-y-2">
            {deletes.map((d) => {
              const chat = byId.get(d.chatId);
              if (!chat || chat.status !== "active") return null;
              return (
                <li key={d.chatId} className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                  <Checkbox
                    checked={Boolean(deleteSel[d.chatId])}
                    onCheckedChange={() => toggle(deleteSel, setDeleteSel, d.chatId)}
                    className="mt-0.5"
                    aria-label={`Select ${chat.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{chat.title}</p>
                      <Badge variant={d.severity === "clutter" ? "danger" : d.severity === "duplicate" ? "warn" : "outline"}>
                        {d.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{d.reason}</p>
                  </div>
                </li>
              );
            })}
            {extraDeletes.map((d) => {
              const chat = byId.get(d.chatId);
              if (!chat || chat.status !== "active") return null;
              return (
                <li key={`ai-${d.chatId}`} className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                  <Checkbox
                    checked={Boolean(deleteSel[d.chatId])}
                    onCheckedChange={() => toggle(deleteSel, setDeleteSel, d.chatId)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{chat.title}</p>
                      <Badge variant="silver">Grok</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{d.reason}</p>
                  </div>
                </li>
              );
            })}
            {!deletes.length && !extraDeletes.length && (
              <li className="text-sm text-muted-foreground">No hide suggestions. Lucky you.</li>
            )}
          </ul>
          <Button className="mt-4" onClick={applyDeletes}>
            Remove selected from Sift
          </Button>
        </TabsContent>

        <TabsContent value="merge">
          <ul className="space-y-3">
            {merges.map((m) => {
              const titles = m.chatIds.map((id) => byId.get(id)).filter((c) => c && c.status === "active");
              if (titles.length < 2) return null;
              return (
                <li key={m.id} className="rounded-xl border border-border px-4 py-3">
                  <label className="flex items-start gap-3">
                    <Checkbox
                      checked={Boolean(mergeSel[m.id])}
                      onCheckedChange={() => toggle(mergeSel, setMergeSel, m.id)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium">{m.title}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{m.reason}</span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {titles.map((c) => (
                          <Badge key={c!.id} variant="outline">
                            {c!.title}
                          </Badge>
                        ))}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
            {(ai?.extraMerges ?? []).map((m, i) => (
              <li key={`ai-m-${i}`} className="rounded-xl border border-dashed border-border px-4 py-3">
                <p className="text-sm font-medium">{m.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{m.reason}</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => mergeChats(m.chatIds, m.title)}>
                  Merge this group
                </Button>
              </li>
            ))}
            {!merges.length && <li className="text-sm text-muted-foreground">No merge groups right now.</li>}
          </ul>
          <Button className="mt-4" onClick={applyMerges}>
            Merge selected in Sift
          </Button>
        </TabsContent>

        <TabsContent value="organize">
          <ol className="space-y-3">
            {(analysis?.orgSuggestions ?? []).map((o, i) => (
              <li key={o.id} className="rounded-xl border border-border bg-card px-4 py-4">
                <p className="text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-1 text-sm font-medium">{o.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{o.detail}</p>
              </li>
            ))}
          </ol>

          <div className="mt-5 rounded-xl border border-border px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Working set to keep in Grok</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  pinWorkingSet();
                  toast.success("Pinned the working set in Sift. Pin the same titles in Grok.");
                }}
              >
                Pin these here
              </Button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {(analysis?.workingSetIds ?? []).map((id) => (
                <li key={id} className="text-sm">
                  {byId.get(id)?.title}
                </li>
              ))}
            </ul>
          </div>

          {renames.length > 0 && (
            <div className="mt-5 rounded-xl border border-border px-4 py-4">
              <h3 className="text-sm font-medium">Rename suggestions</h3>
              <p className="mt-1 text-sm text-muted-foreground">Topic first, so the Grok sidebar scans in one glance.</p>
              <ul className="mt-3 space-y-2">
                {renames.map((r) => {
                  const chat = byId.get(r.chatId);
                  if (!chat || chat.status !== "active") return null;
                  return (
                    <li key={r.chatId} className="flex items-start gap-3">
                      <Checkbox
                        checked={Boolean(renameSel[r.chatId])}
                        onCheckedChange={() => toggle(renameSel, setRenameSel, r.chatId)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 text-sm">
                        <p className="text-muted-foreground line-through">{chat.title}</p>
                        <p className="font-medium">{r.suggested}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Button
                className="mt-4"
                size="sm"
                onClick={() => {
                  const ids = Object.entries(renameSel)
                    .filter(([, v]) => v)
                    .map(([k]) => k);
                  if (!ids.length) {
                    applyRenames();
                    toast.success("Applied all suggested names in Sift.");
                  } else {
                    applyRenames(ids);
                    toast.success("Renamed in Sift. Mirror the names in Grok.");
                  }
                  setRenameSel({});
                }}
              >
                Apply names in Sift
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="grok">
          <p className="text-sm text-muted-foreground">
            Tick these as you finish them in grok.com or the Dock app. They stay on this device.
            {grokItems > 0 ? ` ${Math.min(grokDone, grokItems)} of ${grokItems} done.` : ""}
          </p>
          <ul className="mt-4 space-y-2">
            {deletes.map((d) => {
              const chat = byId.get(d.chatId);
              if (!chat) return null;
              const key = `del-${d.chatId}`;
              return (
                <li key={key}>
                  <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                    <Checkbox checked={Boolean(grokChecks[key])} onCheckedChange={() => toggleGrokCheck(key)} className="mt-0.5" />
                    <span className={cn("text-sm", grokChecks[key] && "text-muted-foreground line-through")}>
                      Delete in Grok: {chat.title}
                    </span>
                  </label>
                </li>
              );
            })}
            {merges.map((m) => {
              const key = `merge-${m.id}`;
              const titles = m.chatIds
                .map((id) => byId.get(id)?.title)
                .filter(Boolean)
                .join(" + ");
              return (
                <li key={key}>
                  <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                    <Checkbox checked={Boolean(grokChecks[key])} onCheckedChange={() => toggleGrokCheck(key)} className="mt-0.5" />
                    <span className={cn("text-sm", grokChecks[key] && "text-muted-foreground line-through")}>
                      Collapse in Grok: {titles}
                    </span>
                  </label>
                </li>
              );
            })}
            {renames.slice(0, 8).map((r) => {
              const chat = byId.get(r.chatId);
              if (!chat) return null;
              const key = `ren-${r.chatId}`;
              return (
                <li key={key}>
                  <label className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
                    <Checkbox checked={Boolean(grokChecks[key])} onCheckedChange={() => toggleGrokCheck(key)} className="mt-0.5" />
                    <span className={cn("text-sm", grokChecks[key] && "text-muted-foreground line-through")}>
                      Rename in Grok: {chat.title} → {r.suggested}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </TabsContent>
      </Tabs>

      {removed.length > 0 && (
        <section>
          <h2 className="text-sm font-medium">Removed from Sift</h2>
          <ul className="mt-2 space-y-1">
            {removed.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{c.title}</span>
                <Button variant="ghost" size="sm" onClick={() => restoreChat(c.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-subtle">
        {active.length} active in this library
        {analysis ? ` · ${deletes.length} suggested deletes · ${merges.length} merge groups` : ""}
      </p>
    </div>
  );
}
