import JSZip from "jszip";
import { parseWithAdapters } from "@/lib/sift/providers";
import { chatsToCanonical } from "@/lib/sift/providers/canonical";
import { PARSER_VERSION } from "@/lib/sift/parsers";
import { peekSqliteBytes } from "@/lib/sift/sqlite";
import type { ImportBundle } from "@/lib/sift/types";
import { parseImport } from "./parse";
import type { Chat, ImportMode } from "./types";
import { toViewChat } from "@/lib/sift/view";
import { bundleFromText } from "@/lib/sift/providers/generic";

function isZip(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

function isSqlite(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".sqlite") || name.endsWith(".db") || name.endsWith(".sqlite3");
}

async function bundlesFromZip(file: File, bytes: Uint8Array, mode: ImportMode): Promise<ImportBundle[]> {
  const zip = await JSZip.loadAsync(bytes);
  const jsonEntries = Object.values(zip.files).filter((f) => !f.dir && /\.json$/i.test(f.name));
  const textEntries = Object.values(zip.files).filter((f) => !f.dir && /\.(txt|md|markdown)$/i.test(f.name));
  const entries = jsonEntries.length ? jsonEntries : textEntries;
  if (!entries.length) {
    return [
      {
        provider: "generic",
        label: file.name,
        filename: file.name,
        mime: file.type || "application/zip",
        conversations: [],
        warnings: ["ZIP had no JSON or text files Sift can read."],
        skipped: [],
        failed: [{ reason: "Empty or unsupported ZIP" }],
        parser: "generic",
        parserVersion: PARSER_VERSION.generic,
        rawBytes: bytes,
      },
    ];
  }
  const merged: ImportBundle[] = [];
  for (const entry of entries) {
    const text = await entry.async("string");
    if (mode === "titles" || mode === "transcripts") {
      merged.push(
        bundleFromText(text, {
          provider: "generic",
          label: `${file.name} · ${entry.name}`,
          filename: entry.name,
          mode,
        }),
      );
    } else {
      merged.push(parseWithAdapters(text, entry.name));
    }
  }
  const conversations = merged.flatMap((b) => b.conversations);
  const skipped = merged.flatMap((b) => b.skipped);
  const failed = merged.flatMap((b) => b.failed);
  const warnings = merged.flatMap((b) => b.warnings);
  const provider = merged.find((b) => b.conversations.length)?.provider ?? "generic";
  const parserVersion = merged.find((b) => b.conversations.length)?.parserVersion ?? PARSER_VERSION.generic;
  return [
    {
      provider,
      label: `ZIP · ${file.name}`,
      filename: file.name,
      mime: file.type || "application/zip",
      conversations,
      warnings: warnings.length ? warnings : conversations.length ? [] : ["Nothing parsed in this ZIP."],
      skipped,
      failed,
      parser: provider,
      parserVersion,
      expectedConversationCount: merged.reduce((n, b) => n + (b.expectedConversationCount ?? b.conversations.length), 0),
      rawBytes: bytes,
    },
  ];
}

export function parseImportMany(texts: string[], mode: ImportMode): Chat[] {
  const out: Chat[] = [];
  for (const text of texts) {
    out.push(...parseImport(text, mode));
  }
  return out;
}

export async function parseFilesToBundles(files: File[], mode: ImportMode): Promise<ImportBundle[]> {
  const bundles: ImportBundle[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isSqlite(file)) {
      const stats = await peekSqliteBytes(bytes, file.name);
      bundles.push({
        provider: "sift",
        label: `Sift archive · ${file.name}`,
        filename: file.name,
        mime: "application/x-sqlite3",
        conversations: [],
        warnings: [
          "This is a restore, not an import. It will replace the current archive after you confirm. Merge is not implemented.",
        ],
        skipped: [],
        failed: [],
        parser: "sift",
        parserVersion: PARSER_VERSION.sift,
        restore: { ...stats, bytes },
      });
      continue;
    }
    if (isZip(file)) {
      bundles.push(...(await bundlesFromZip(file, bytes, mode)));
      continue;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (mode === "titles" || mode === "transcripts") {
      const bundle = bundleFromText(text, {
        provider: "generic",
        label: file.name,
        filename: file.name,
        mode,
        mime: file.type || "text/plain",
      });
      bundle.rawBytes = bytes;
      bundles.push(bundle);
    } else {
      const bundle = parseWithAdapters(text, file.name);
      bundle.rawBytes = bytes;
      bundle.mime = file.type || bundle.mime || "application/json";
      bundles.push(bundle);
    }
  }
  return bundles;
}

export async function parseFiles(files: File[], mode: ImportMode): Promise<Chat[]> {
  const bundles = await parseFilesToBundles(files, mode);
  return bundles.flatMap((b) => b.conversations.map((c) => toViewChat(c)));
}
