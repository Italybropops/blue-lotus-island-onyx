import type { Chat } from "@/lib/chats/types";
import { bootstrapArchive } from "./legacy";
import { getSetting, loadAllConversations } from "./repo";
import { persistNow } from "./sqlite";
import { toViewChat } from "./view";

export function visibleChats(all: Chat[], usingDemo: boolean): Chat[] {
  if (usingDemo) return all.filter((c) => c.source === "demo");
  return all.filter((c) => c.source !== "demo");
}

export async function loadVisibleLibrary(): Promise<{ chats: Chat[]; usingDemo: boolean; allCount: number }> {
  const convs = await loadAllConversations();
  const usingDemo = (await getSetting("usingDemo")) === true;
  const all = convs.map(toViewChat);
  return { chats: visibleChats(all, usingDemo), usingDemo, allCount: all.length };
}

let opening: Promise<{ chats: Chat[]; usingDemo: boolean; allCount: number }> | null = null;

export async function openArchive(): Promise<{ chats: Chat[]; usingDemo: boolean; allCount: number }> {
  if (opening) return opening;
  opening = (async () => {
    await bootstrapArchive();
    const loaded = await loadVisibleLibrary();
    await persistNow();
    return loaded;
  })().catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}