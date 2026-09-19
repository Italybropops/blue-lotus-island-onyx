import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import type { Analysis, Chat } from "./types";

export function relDate(iso: string): string {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export function absDate(iso: string): string {
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

export function msgLabel(n: number): string {
  return n === 1 ? "1 message" : `${n} messages`;
}

export function flagsFor(chat: Chat, analysis: Analysis | null): string[] {
  if (!analysis) return [];
  const out: string[] = [];
  if (chat.pinned) out.push("pinned");
  if (chat.archived) out.push("parked");
  if (analysis.clutterIds.includes(chat.id)) out.push("clutter");
  if (analysis.duplicateGroups.some((g) => g.chatIds.includes(chat.id) && g.keepId !== chat.id)) {
    out.push("duplicate");
  } else if (analysis.duplicateGroups.some((g) => g.keepId === chat.id && g.chatIds.length > 1)) {
    out.push("canonical");
  }
  if (analysis.workingSetIds.includes(chat.id)) out.push("working");
  return out;
}

export function downloadText(filename: string, text: string, type = "text/plain"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type = "application/octet-stream"): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
