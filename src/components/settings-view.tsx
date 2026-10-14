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
    attachments: number;
    exactDuplicates: number;
    rawRetained: number;
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
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Stage 1.5 archive integrity</p>
        <h1 className="font-display mt-2 text-4xl leading-tight tracking-tight">Archive, on this device</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The live store is SQLite compiled to WebAssembly in this tab, with a snapshot in IndexedDB. That is not a
          Mac folder. Download a .sqlite backup if you want a file you can keep. Original exports live in a separate
          blob store (OPFS or IndexedDB), not as giant SQLite blobs.
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
        <Stat label="Attachments" value={stats?.attachments ?? "—"} />
        <Stat label="Raw retained" value={stats?.rawRetained ?? "—"} />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-2xl">What this archive actually is</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="text-foreground">Download SQLite</span> is a backup snapshot of structured data, not the
            live Mac database. Restore on Import is a full replace and asks first.
          </li>
          <li>
            <span className="text-foreground">JSON download</span> is a lossy view for reading — it is not a restore
            format. Use SQLite for recovery.
          </li>
          <li>
            <span className="text-foreground">Original exports</span> are stored beside SQLite in this browser when the
            blob store allows it. Clearing site data still wipes both.
          </li>
          <li>
            <span className="text-foreground">Hide, park, merge</span> never delete rows. Exact duplicates are linked,
            not collapsed.
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
        <p className="mt-3 text-xs text-subtle">
          Schema {stats?.schemaVersion ?? "—"}. Drop a .sqlite on Import to restore (replace, with confirmation). Merge
          of two archives is not implemented.
        </p>
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
                  <p className="text-xs text-muted-foreground">
                    {s.parserVersion || s.parser} · {s.conversationCount} chats
                    {s.rawRetained ? " · original kept" : " · original not kept"}
                    {s.rawSha256 ? ` · ${s.rawSha256.slice(0, 12)}…` : ""}
                  </p>
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
          Embeddings, knowledge extraction (facts, preferences, decisions), Ollama/MLX, a Gemini importer,
          and resume-able processing jobs. Perplexity’s official conversations export is imported. The tables exist so
          later stages can be added without throwing this archive away.
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
