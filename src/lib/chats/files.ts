import JSZip from "jszip";
import { parseWithAdapters } from "@/lib/sift/providers";
import { chatsToCanonical } from "@/lib/sift/providers/canonical";
import { replaceSqlite } from "@/lib/sift/sqlite";
import type { ImportBundle } from "@/lib/sift/types";
import { parseImport } from "./parse";
import type { Chat, ImportMode } from "./types";
import { toViewChat } from "@/lib/sift/view";

const PREFERRED_JSON = /(prod-grok-backend|conversations|chats|grok).*\.json$/i;

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

async function textsFromZip(file: File): Promise<{ text: string; filename: string }[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const jsonEntries = Object.values(zip.files).filter((f) => !f.dir && /\.json$/i.test(f.name));
  const preferred = jsonEntries.filter((f) => PREFERRED_JSON.test(f.name));
  const pick = preferred.length ? preferred : jsonEntries;
  if (pick.length) {
    const chunks: { text: string; filename: string }[] = [];
    for (const entry of pick.slice(0, 12)) {
      chunks.push({ text: await entry.async("string"), filename: entry.name });
    }
    return chunks;
  }
  const textEntries = Object.values(zip.files).filter((f) => !f.dir && /\.(txt|md|markdown)$/i.test(f.name));
  const chunks: { text: string; filename: string }[] = [];
  for (const entry of textEntries.slice(0, 40)) {
    chunks.push({ text: await entry.async("string"), filename: entry.name });
  }
  return chunks;
}

export function parseImportMany(texts: string[], mode: ImportMode): Chat[] {
  const seen = new Set<string>();
  const out: Chat[] = [];
  for (const text of texts) {
    for (const chat of parseImport(text, mode)) {
      const key = `${chat.title}::${chat.messages[0]?.content.slice(0, 80) ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(chat);
      if (out.length >= 10_000) return out;
    }
  }
  return out;
}

export async function parseFilesToBundles(files: File[], mode: ImportMode): Promise<ImportBundle[]> {
  const bundles: ImportBundle[] = [];
  for (const file of files) {
    if (isSqlite(file)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await replaceSqlite(bytes);
      bundles.push({
        provider: "sift",
        label: `Sift archive · ${file.name}`,
        filename: file.name,
        conversations: [],
        warnings: ["Replaced the local SQLite archive with this file. Conversations were not copied twice."],
      });
      continue;
    }
    const parts = isZip(file) ? await textsFromZip(file) : [{ text: await file.text(), filename: file.name }];
    for (const part of parts) {
      if (mode === "titles" || mode === "transcripts") {
        const chats = parseImport(part.text, mode);
        bundles.push({
          provider: "generic",
          label: part.filename,
          filename: part.filename,
          conversations: chatsToCanonical(chats, "pending", "generic"),
          warnings: chats.length ? [] : ["Nothing parsed in this file."],
        });
      } else {
        bundles.push(parseWithAdapters(part.text, part.filename));
      }
    }
  }
  return bundles;
}

export async function parseFiles(files: File[], mode: ImportMode): Promise<Chat[]> {
  const bundles = await parseFilesToBundles(files, mode);
  return bundles.flatMap((b) => b.conversations.map((c) => toViewChat(c)));
}
