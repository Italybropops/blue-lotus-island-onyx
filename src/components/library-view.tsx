import { Copy, Pin, PinOff, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { summarizeChat } from "@/lib/ai/deep-analyze";
import { flagsFor, msgLabel, relDate } from "@/lib/chats/format";
import { activeChats, useChatStore } from "@/lib/chats/store";
import { CATEGORIES, type Category, type Chat } from "@/lib/chats/types";
import { cn } from "@/lib/utils";

function flagBadge(flag: string) {
  if (flag === "clutter") return <Badge variant="danger">clutter</Badge>;
  if (flag === "duplicate") return <Badge variant="warn">repeat</Badge>;
  if (flag === "canonical") return <Badge variant="keep">keep</Badge>;
  if (flag === "pinned") return <Badge variant="silver">pinned</Badge>;
  if (flag === "parked") return <Badge variant="outline">parked</Badge>;
  if (flag === "working") return <Badge variant="outline">working set</Badge>;
  return <Badge>{flag}</Badge>;
}

export function LibraryView() {
  const chats = useChatStore((s) => s.chats);
  const analysis = useChatStore((s) => s.analysis);
  const selectedId = useChatStore((s) => s.selectedId);
  const select = useChatStore((s) => s.select);
  const query = useChatStore((s) => s.query);
  const setQuery = useChatStore((s) => s.setQuery);
  const categoryFilter = useChatStore((s) => s.categoryFilter);
  const setCategoryFilter = useChatStore((s) => s.setCategoryFilter);
  const flagFilter = useChatStore((s) => s.flagFilter);
  const setFlagFilter = useChatStore((s) => s.setFlagFilter);

  const active = activeChats(chats);
  const selected = chats.find((c) => c.id === selectedId && c.status === "active") ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active
      .filter((c) => (categoryFilter === "All" ? true : c.category === categoryFilter))
      .filter((c) => {
        if (flagFilter === "pinned") return c.pinned;
        if (flagFilter === "archived") return c.archived;
        if (flagFilter === "clutter") return analysis?.clutterIds.includes(c.id);
        if (flagFilter === "duplicates")
          return analysis?.duplicateGroups.some((g) => g.chatIds.includes(c.id));
        return true;
      })
      .filter((c) => {
        if (!q) return true;
        return `${c.title} ${c.summary} ${c.category} ${c.messages.map((m) => m.content).join(" ")}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [active, analysis, categoryFilter, flagFilter, query]);

  return (
    <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
      <section className="min-w-0 px-4 py-5 lg:px-8">
        <p className="mb-4 text-sm text-muted-foreground">
          {active.length} chats
          {analysis ? ` · ${analysis.clutterIds.length} clutter · ${analysis.duplicateGroups.length} repeat clusters` : ""}
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and summaries"
            className="pl-10"
            aria-label="Search chats"
          />
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {(["All", ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors duration-150",
                categoryFilter === cat
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          {(
            [
              ["all", "All"],
              ["duplicates", "Repeats"],
              ["clutter", "Clutter"],
              ["pinned", "Pinned"],
              ["archived", "Parked"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFlagFilter(id)}
              className={cn(
                "h-9 rounded-md px-3 text-xs font-medium transition-colors duration-150",
                flagFilter === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <ul className="mt-5 space-y-2">
          {filtered.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
              Nothing matches. Import chats or clear filters.
            </li>
          ) : (
            filtered.map((chat) => {
              const flags = flagsFor(chat, analysis);
              const on = selectedId === chat.id;
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => select(chat.id)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3.5 text-left transition-colors duration-150",
                      on ? "border-silver/40 bg-card" : "border-border bg-transparent hover:bg-card/80",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm leading-snug font-medium">{chat.title}</h3>
                      <span className="shrink-0 text-xs text-subtle tabular-nums">{relDate(chat.updatedAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{chat.summary}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{chat.category}</Badge>
                      <span className="text-xs text-subtle">{msgLabel(chat.messages.length)}</span>
                      {flags
                        .filter((f) => f !== "working")
                        .map((f) => (
                          <span key={f}>{flagBadge(f)}</span>
                        ))}
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <aside
        className={cn(
          "border-border bg-card lg:sticky lg:top-0 lg:h-[calc(100dvh-3.5rem)] lg:border-l",
          selected ? "fixed inset-0 z-50 lg:static lg:z-0" : "hidden lg:block",
        )}
      >
        {selected ? (
          <ChatDetail chat={selected} onClose={() => select(null)} />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            Select a chat to read the thread, recategorize, or pin it.
          </div>
        )}
      </aside>
    </div>
  );
}

function ChatDetail({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const recategorize = useChatStore((s) => s.recategorize);
  const togglePin = useChatStore((s) => s.togglePin);
  const removeChats = useChatStore((s) => s.removeChats);
  const setArchived = useChatStore((s) => s.setArchived);
  const patchSummary = useChatStore((s) => s.patchSummary);
  const analysis = useChatStore((s) => s.analysis);
  const flags = flagsFor(chat, analysis);
  const rename = analysis?.renameSuggestions.find((r) => r.chatId === chat.id);
  const applyRenames = useChatStore((s) => s.applyRenames);
  const [summarizing, setSummarizing] = useState(false);

  async function copyTitle() {
    await navigator.clipboard.writeText(chat.title);
    toast.success("Title copied — paste into Grok’s search.");
  }

  async function runSummary() {
    const ok = window.confirm(
      "This optional summary sends this chat’s text to xAI (off-device). Local analysis does not need that. Continue?",
    );
    if (!ok) return;
    setSummarizing(true);
    try {
      const transcript = chat.messages
        .map((m) => `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      const result = await summarizeChat({ data: { title: chat.title, transcript } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      patchSummary(chat.id, result.summary);
      toast.success("Summary updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Summarize failed.");
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{relDate(chat.updatedAt)}</p>
          <h2 className="font-display mt-1 text-2xl leading-snug">{chat.title}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat" className="shrink-0">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5">
        {flags.map((f) => (
          <span key={f}>{flagBadge(f)}</span>
        ))}
      </div>
      <p className="mt-3 px-5 text-sm leading-relaxed text-muted-foreground">{chat.summary}</p>
      {rename && (
        <div className="mt-3 px-5">
          <p className="text-xs text-muted-foreground">Suggested name</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm">{rename.suggested}</p>
            <Button variant="outline" size="sm" onClick={() => applyRenames([chat.id])}>
              Use this name
            </Button>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2 px-5">
        <label className="flex h-11 items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground">
          Topic
          <select
            className="bg-transparent text-sm text-foreground focus:outline-none"
            value={chat.category}
            onChange={(e) => recategorize(chat.id, e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => togglePin(chat.id)}>
          {chat.pinned ? <PinOff /> : <Pin />}
          {chat.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setArchived([chat.id], !chat.archived)}>
          {chat.archived ? "Unpark" : "Park in Sift"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void copyTitle()}>
          <Copy />
          Copy title
        </Button>
        <Button variant="outline" size="sm" onClick={() => void runSummary()} disabled={summarizing}>
          <Sparkles />
          {summarizing ? "Summarizing…" : "Summarize"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => removeChats([chat.id])}>
          Remove from Sift
        </Button>
      </div>
      <Separator className="mt-4" />
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-5 py-5">
          {chat.messages.map((m) => (
            <article key={m.id} className="rounded-lg bg-muted/60 px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {m.role === "user" ? "You" : "Grok"}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
            </article>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
