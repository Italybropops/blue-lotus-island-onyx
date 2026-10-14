import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseFilesToBundles } from "@/lib/chats/files";
import { downloadText } from "@/lib/chats/format";
import { useChatStore } from "@/lib/chats/store";
import type { ImportMode } from "@/lib/chats/types";
import { parseWithAdapters } from "@/lib/sift/providers";
import { bundleFromText } from "@/lib/sift/providers/generic";
import { cn } from "@/lib/utils";

const MODES: { id: ImportMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Detect Grok, ChatGPT, Claude, ZIP, transcripts, or titles" },
  { id: "titles", label: "Sidebar titles", hint: "One chat name per line" },
  { id: "transcripts", label: "Full chats", hint: "Paste threads with You / Assistant labels" },
];

export function ImportView() {
  const importBundles = useChatStore((s) => s.importBundles);
  const confirmRestore = useChatStore((s) => s.confirmRestore);
  const cancelRestore = useChatStore((s) => s.cancelRestore);
  const pendingRestore = useChatStore((s) => s.pendingRestore);
  const chats = useChatStore((s) => s.chats);
  const loadDemo = useChatStore((s) => s.loadDemo);
  const clearLibrary = useChatStore((s) => s.clearLibrary);
  const usingDemo = useChatStore((s) => s.usingDemo);
  const lastImport = useChatStore((s) => s.lastImport);
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<ImportMode>("auto");
  const [busy, setBusy] = useState(false);

  async function ingestText(raw: string, write: "append" | "replace") {
    const bundle =
      mode === "auto" ? parseWithAdapters(raw) : bundleFromText(raw, { provider: "generic", label: "Pasted text", mode });
    if (!bundle.conversations.length) {
      toast.error("Couldn’t find a chat in that paste. Drop an export ZIP, add speaker labels, or switch to titles.");
      return;
    }
    setBusy(true);
    try {
      const report = await importBundles([bundle], write);
      setText("");
      toast.success(
        `Imported ${report.inserted} chats as ${bundle.provider}` +
          (report.skipped ? ` · ${report.skipped} skipped` : "") +
          (report.exactDuplicates ? ` · ${report.exactDuplicates} exact duplicates linked` : "") +
          (report.rawRetained ? "" : " · original paste kept if the blob store allowed it"),
      );
      if (!report.persistOk) toast.error(report.persistError ?? "Archive did not save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function ingestFiles(files: FileList | null, write: "append" | "replace") {
    if (!files?.length) return;
    setBusy(true);
    try {
      const bundles = await parseFilesToBundles([...files], mode);
      const restore = bundles.find((b) => b.restore);
      if (restore) {
        await importBundles(bundles, write);
        return;
      }
      const count = bundles.reduce((n, b) => n + b.conversations.length, 0);
      if (!count && !bundles.some((b) => (b.skipped?.length ?? 0) > 0)) {
        toast.error("No chats in those files. Use an export ZIP/JSON, a Sift .sqlite, or a title list.");
        return;
      }
      const report = await importBundles(bundles, write);
      const provider = [...new Set(bundles.map((b) => b.provider))].join(", ");
      toast.success(
        `Imported ${report.inserted} chats (${provider})` +
          (report.skipped ? ` · ${report.skipped} skipped` : "") +
          (report.failed ? ` · ${report.failed} failed` : "") +
          (report.exactDuplicates ? ` · ${report.exactDuplicates} exact duplicates linked` : "") +
          (report.rawRetained ? "" : " · original file could not be kept in this browser"),
      );
      if (!report.persistOk) toast.error(report.persistError ?? "Archive did not save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t read those files.");
    } finally {
      setBusy(false);
    }
  }

  function exportLibrary() {
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
    toast.success("Library JSON downloaded.");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 lg:px-8">
      <header>
        <h1 className="font-display text-4xl leading-tight tracking-tight">Bring chats in</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Adapters read Grok, ChatGPT, Claude, and Perplexity exports. Original files are kept in this browser’s blob store
          (OPFS or IndexedDB) so they can be re-parsed later. Gemini is not supported yet. A Perplexity file is never
          relabeled as Grok.
        </p>
      </header>

      {pendingRestore && (
        <section className="rounded-xl border border-destructive/40 bg-card p-5">
          <h2 className="font-display text-2xl">Replace current archive?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Restore replaces the archive in this browser. It does not merge. A snapshot of the current archive is saved
            first when possible.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>Current library: {chats.length} conversations in this tab</li>
            <li>
              Incoming file: {pendingRestore.filename} · {pendingRestore.conversations} conversations ·{" "}
              {pendingRestore.messages} messages · schema {pendingRestore.schemaVersion}
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const report = await confirmRestore();
                    toast.success(report.warnings[0] ?? "Archive restored.");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Restore failed.");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              disabled={busy}
            >
              Replace archive
            </Button>
            <Button variant="outline" onClick={() => cancelRestore()} disabled={busy}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {lastImport && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Last import: {lastImport.inserted} conversations · {lastImport.skipped} skipped · {lastImport.failed} failed
          {lastImport.exactDuplicates ? ` · ${lastImport.exactDuplicates} exact-duplicate links` : ""}
          {lastImport.rawRetained ? " · original retained" : " · original not retained"}
          {lastImport.persistOk ? "" : ` · SAVE FAILED: ${lastImport.persistError ?? ""}`}
          {lastImport.warnings[0] ? ` ${lastImport.warnings[0]}` : ""}
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Best: official export files</h2>
        <ul className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Grok.</span> accounts.x.ai/data — drop the ZIP. Sift reads
            prod-grok-backend.json and related conversation JSON.
          </li>
          <li>
            <span className="font-medium text-foreground">ChatGPT.</span> Export from ChatGPT settings and drop{" "}
            <span className="text-foreground">conversations.json</span>.
          </li>
          <li>
            <span className="font-medium text-foreground">Claude.</span> Export from Claude settings (conversations
            with chat_messages).
          </li>
          <li>
            <span className="font-medium text-foreground">Perplexity.</span> Export my data, then drop the{" "}
            <span className="text-foreground">conversations-….json</span> file. Threads stay Perplexity. They are not
            filed as Grok.
          </li>
          <li>
            <span className="font-medium text-foreground">Sift backup.</span> Drop a previously downloaded{" "}
            <span className="text-foreground">.sqlite</span> to restore this archive. Restore is a full replace and
            asks for confirmation. Merge of two archives is not implemented.
          </li>
        </ul>
        <p className="mt-3 text-xs text-subtle">No conversation cap. Full message text is kept. Original files are stored separately from SQLite.</p>
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="text-sm font-medium">Faster: copy from a sidebar</h2>
        <ol className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Open the app.</span> grok.com in Safari/Chrome, or the
            Dock app you added from Safari.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Copy titles or a thread.</span> Sidebar, Cmd+A, Cmd+C —
            title list. Or open a chat, select the messages, copy.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Paste below.</span> Several full chats: put a line with
            only --- between them.
          </li>
        </ol>
      </section>

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors duration-150",
              mode === m.id ? "border-silver/40 bg-card" : "border-border hover:bg-card/80",
            )}
          >
            <span className="block text-sm font-medium">{m.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{m.hint}</span>
          </button>
        ))}
      </div>

      <div
        className={cn(
          "rounded-xl border border-dashed px-4 py-6 transition-colors duration-150",
          drag ? "border-silver bg-card" : "border-border",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void ingestFiles(e.dataTransfer.files, usingDemo ? "replace" : "append");
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            mode === "titles"
              ? "Fix TypeScript error in React Query\nWeekend in Kyoto itinerary\nhi\ntest"
              : `You\nHow do I type useQuery in React Query v5?\n\nGrok\nPass a generic…\n\n---\n\nYou\nhi`
          }
          aria-label="Paste chats"
        />
        <p className="mt-3 text-xs text-subtle">Or drop a .zip, .json, .sqlite, .txt, or .md file onto this panel.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void ingestText(text, usingDemo ? "replace" : "append")} disabled={!text.trim() || busy}>
            {usingDemo ? "Replace sample with paste" : "Add to library"}
          </Button>
          <Button variant="outline" onClick={() => void ingestText(text, "replace")} disabled={!text.trim() || busy}>
            Park current & import
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".txt,.md,.json,.zip,.sqlite,.db,.markdown,text/plain,application/json,application/zip"
              multiple
              className="sr-only"
              onChange={(e) => {
                void ingestFiles(e.target.files, usingDemo ? "replace" : "append");
                e.target.value = "";
              }}
            />
            <span className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent">
              {busy ? "Reading…" : "Choose files"}
            </span>
          </label>
        </div>
      </div>

      <section className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => loadDemo()}>
          Show sample library
        </Button>
        <Button variant="outline" onClick={exportLibrary} disabled={!chats.length}>
          Export JSON
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            clearLibrary();
            toast.message("Hidden from the library. Rows remain in SQLite until you export or restore.");
          }}
        >
          Hide library
        </Button>
      </section>
    </div>
  );
}