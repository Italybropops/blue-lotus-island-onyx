import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listInferenceProviders } from "@/lib/sift/ai/registry";
import { archiveStats, listRelationships, listSources } from "@/lib/sift/repo";
import { exportSqliteBytes } from "@/lib/sift/sqlite";
import type { RelationshipRecord, SourceRecord } from "@/lib/sift/types";
import { downloadBytes, downloadText } from "@/lib/chats/format";
import { useChatStore } from "@/lib/chats/store";

export function SettingsView() {
  const chats = useChatStore((s) => s.chats);
  const archiveError = useChatStore((s) => s.archiveError);
  const usingDemo = useChatStore((s) => s.usingDemo);
  const [stats, setStats] = useState<{
    conversations: number;
    messages: number;
    sources: number;
    exactDuplicates: number;
    schemaVersion: string;
  } | null>(null);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [rels, setRels] = useState<RelationshipRecord[]>([]);
  const [providers, setProviders] = useState<{ id: string; label: string; location: string; status: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setStats(await archiveStats());
        setSources(await listSources());
        setRels(await listRelationships());
        const list = listInferenceProviders();
        setProviders(
          await Promise.all(
            list.map(async (p) => ({
              id: p.id,
              label: p.label,
              location: p.location,
              status: await p.status(),
            })),
          ),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not read the archive.");
      }
    })();
  }, [chats.length, usingDemo]);

  async function exportSqlite() {
    const bytes = await exportSqliteBytes();
    downloadBytes("sift-archive.sqlite", bytes, "application/x-sqlite3");
    toast.success("SQLite archive downloaded. Keep this file on your Mac.");
  }

  function exportJson() {
    const payload = chats.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      category: c.category,
      pinned: c.pinned,
      archived: c.archived,
      summary: c.summary,
      status: c.status,
      contentSha256: c.contentSha256,
      messages: c.messages.map((m) => ({ role: m.role, content: m.content })),
    }));
    downloadText("sift-library.json", JSON.stringify(payload, null, 2), "application/json");
    toast.success("JSON export downloaded.");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 lg:px-8">
      <header>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Stage 1 foundation</p>
        <h1 className="font-display mt-2 text-4xl leading-tight tracking-tight">Archive, on this device</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Sift is becoming a local knowledge system. This slice puts conversations in a SQLite database in{" "}
          <em>this browser</em>, stops erasing chats, and treats Grok as an optional off-device helper — not the
          engine.
        </p>
      </header>

      {archiveError && (
        <p className="rounded-lg border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">
          SQLite failed to open ({archiveError}). You are seeing an in-memory copy that will not survive a refresh.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Conversations" value={stats?.conversations ?? "—"} />
        <Stat label="Messages" value={stats?.messages ?? "—"} />
        <Stat label="Sources" value={stats?.sources ?? "—"} />
        <Stat label="Exact dupes" value={stats?.exactDuplicates ?? "—"} />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-2xl">What changed</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="text-foreground">SQLite is the store.</span> Not a giant browser note. You can download
            the <span className="text-foreground">.sqlite</span> file and keep it on your Mac.
          </li>
          <li>
            <span className="text-foreground">Nothing is erased by default.</span> Hide, park, or merge — the original
            rows stay. Relationships record why.
          </li>
          <li>
            <span className="text-foreground">Exact duplicates use SHA-256</span> of normalized messages. That does
            not need an AI model.
          </li>
          <li>
            <span className="text-foreground">Imports keep full text.</span> Long chats are no longer cut off at 12,000
            characters.
          </li>
          <li>
            <span className="text-foreground">Grok / xAI is optional and off-device.</span> Local sorting still runs
            with no network. Confirm before any transcript leaves this machine.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="font-display text-2xl">Why not a shared cloud database</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This preview is a website. A shared server database would be readable by anyone who opens the same app.
          Your chats are private, so they stay in this browser’s SQLite file. Download it if you want a copy that
          lives on the Mac, independent of this tab.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void exportSqlite()}>Download SQLite</Button>
          <Button variant="outline" onClick={exportJson}>
            Download JSON
          </Button>
        </div>
        <p className="mt-3 text-xs text-subtle">Schema version {stats?.schemaVersion ?? "—"}. Drop a .sqlite file on Import to restore it.</p>
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="font-display text-2xl">Models</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Local analysis (categories, clutter, near-duplicates) always runs here. Heavier models — Ollama or MLX on
          your M2 Pro — are the next slice. They are not connected yet.
        </p>
        <ul className="mt-4 space-y-3">
          {providers.map((p) => (
            <li key={p.id} className="rounded-lg border border-border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{p.label}</p>
                <Badge variant="outline">{p.location === "external" ? "leaves device" : p.location}</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.status}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="font-display text-2xl">Sources</h2>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.notes || s.rawFilename || s.provider}</p>
                </div>
                <Badge variant="outline">{s.provider}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="font-display text-2xl">Relationships</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {rels.length === 0
            ? "No duplicate or merge links stored yet. They appear after import or merge."
            : `${rels.length} stored links (exact duplicates, merges). Records are not deleted when linked.`}
        </p>
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="font-display text-2xl">What is not built yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Embeddings, knowledge extraction (facts, preferences, decisions), Ollama/MLX, Gemini/Perplexity importers,
          and resume-able processing jobs. The tables exist so those can be added without throwing this archive away.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}
