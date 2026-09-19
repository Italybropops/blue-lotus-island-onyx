import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TriageBoard } from "@/components/triage-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activeChats, useChatStore } from "@/lib/chats/store";
import { CATEGORIES, type CleanupTab } from "@/lib/chats/types";
import { cn } from "@/lib/utils";

export function InsightsView() {
  const chats = useChatStore((s) => s.chats);
  const analysis = useChatStore((s) => s.analysis);
  const ai = useChatStore((s) => s.aiAnalysis);
  const select = useChatStore((s) => s.select);
  const setView = useChatStore((s) => s.setView);
  const setFlagFilter = useChatStore((s) => s.setFlagFilter);
  const setQuery = useChatStore((s) => s.setQuery);
  const setCleanupTab = useChatStore((s) => s.setCleanupTab);
  const setCategoryFilter = useChatStore((s) => s.setCategoryFilter);

  const active = activeChats(chats);
  const byCat = CATEGORIES.map((cat) => ({
    name: cat,
    count: active.filter((c) => c.category === cat).length,
  })).filter((d) => d.count > 0);

  const deletes = analysis?.deleteSuggestions.length ?? 0;
  const merges = analysis?.mergeSuggestions.length ?? 0;
  const repeats = analysis?.duplicateGroups.length ?? 0;
  const clutter = analysis?.clutterIds.length ?? 0;
  const working = analysis?.workingSetIds.length ?? 0;
  const archive = analysis?.archiveIds.length ?? 0;

  function openCleanup(tab: CleanupTab) {
    setCleanupTab(tab);
    setView("cleanup");
  }

  function openLibrary(flag: "all" | "duplicates" | "clutter" | "pinned" | "archived", query = "") {
    setFlagFilter(flag);
    setCategoryFilter("All");
    setQuery(query);
    setView("library");
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 lg:px-8">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Analysis</p>
        <h1 className="font-display mt-2 text-4xl leading-tight tracking-tight">
          {active.length === 0
            ? "Import a library to sift it."
            : `${deletes} to hide, ${merges} to merge, ${working} to keep in Grok.`}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Local analysis runs on this device: summaries, topics, repeats, clutter. External AI is optional and
          off-device — confirm in the header if you want rewritten summaries. Keep a short working set in Grok; park
          the rest in this archive.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ActionCard
          label="Hide"
          value={deletes}
          hint="Clutter, weaker copies, stale one-offs — reversible"
          onClick={() => openCleanup("delete")}
        />
        <ActionCard
          label="Merge"
          value={merges}
          hint="Same question, split across threads"
          onClick={() => openCleanup("merge")}
        />
        <ActionCard
          label="Repeats"
          value={repeats}
          hint="Clusters circling the same ground"
          onClick={() => openLibrary("duplicates")}
        />
        <ActionCard
          label="Working set"
          value={working}
          hint={`${archive} more to park here`}
          onClick={() => openCleanup("organize")}
        />
      </section>

      {active.length > 0 && <TriageBoard />}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">How to run this on a Mac</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Keep {working} live in grok.com or the Grok app you added from Safari. Park {archive} reference
              threads in Sift. Clear {clutter} clutter so the sidebar can breathe.
            </p>
          </div>
          <Button onClick={() => openCleanup("organize")}>Open the checklist</Button>
        </div>
        <ol className="mt-5 grid gap-3 md:grid-cols-2">
          {(analysis?.orgSuggestions ?? []).map((o, i) => (
            <li key={o.id} className="rounded-lg bg-muted/70 px-4 py-4">
              <p className="text-xs text-muted-foreground tabular-nums">
                {String(i + 1).padStart(2, "0")} · {o.kind}
              </p>
              <h3 className="mt-1 text-sm font-medium">{o.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{o.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-sm font-medium">Repeat topics</h2>
        <ul className="mt-3 space-y-2">
          {(analysis?.repeatTopics ?? []).map((t) => (
            <li key={t.label}>
              <button
                type="button"
                onClick={() => openLibrary("all", t.label)}
                className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-card"
              >
                <div>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.chatIds.length} chats circling the same ground</p>
                </div>
                <Badge variant="outline">{t.category}</Badge>
              </button>
            </li>
          ))}
          {!analysis?.repeatTopics.length && (
            <li className="text-sm text-muted-foreground">No repeated topics yet.</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">By topic</h2>
        <div className="mt-4 h-56">
          {byCat.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCat} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    color: "var(--color-foreground)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="var(--color-silver)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground">Import chats to see a breakdown.</p>
          )}
        </div>
      </section>

      {ai ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs tracking-wide text-silver uppercase">Grok deep pass</p>
          <p className="mt-3 text-sm leading-relaxed">{ai.overview}</p>
          {ai.hybridPlan.length > 0 && (
            <ul className="mt-4 space-y-2">
              {ai.hybridPlan.map((line) => (
                <li key={line} className="text-sm text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {ai.notes.map((n) => (
              <article key={n.title} className="rounded-lg bg-muted/70 px-4 py-3">
                <h3 className="text-sm font-medium">{n.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
              </article>
            ))}
          </div>
          {ai.summaries.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium">Summaries</h3>
              <ul className="mt-2 space-y-2">
                {ai.summaries.map((s) => {
                  const chat = chats.find((c) => c.id === s.chatId);
                  return (
                    <li key={s.chatId}>
                      <button
                        type="button"
                        className={cn("w-full rounded-lg border border-border px-4 py-3 text-left hover:bg-accent/50")}
                        onClick={() => {
                          select(s.chatId);
                          setView("library");
                        }}
                      >
                        <p className="text-sm font-medium">{chat?.title ?? s.chatId}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Local findings stay here even if you never send anything off-device. They already cover duplicates, clutter,
          and the working set.
        </p>
      )}
    </div>
  );
}

function ActionCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border bg-card px-4 py-4 text-left transition-colors duration-150 hover:border-silver/40"
    >
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-subtle">{hint}</p>
    </button>
  );
}
