import { DEMO_CHATS } from "@/lib/chats/demo";
import type { Chat } from "@/lib/chats/types";
import { conversationCount, getSetting, insertImportUnlocked, setSetting } from "./repo";
import { chatsToCanonical } from "./providers/canonical";
import { newId } from "./ids";
import { withLock } from "./sqlite";

const LEGACY_KEY = "sift-library-v1";
const LEGACY_BAK = "sift-library-v1.bak";

function readLegacyChats(): { chats: Chat[]; usingDemo: boolean } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { chats?: Chat[]; usingDemo?: boolean } };
    const chats = parsed.state?.chats;
    if (!Array.isArray(chats) || !chats.length) return null;
    return { chats, usingDemo: Boolean(parsed.state?.usingDemo) };
  } catch {
    return null;
  }
}

export async function bootstrapArchive(): Promise<{ usingDemo: boolean }> {
  return withLock(async () => {
    const count = await conversationCount();
    if (count > 0) {
      const usingDemo = (await getSetting("usingDemo")) === true;
      return { usingDemo: Boolean(usingDemo) };
    }

    const legacy = readLegacyChats();
    if (legacy) {
      const sourceId = newId("src");
      const provider = legacy.usingDemo ? "demo" : "generic";
      await insertImportUnlocked({
        provider,
        label: legacy.usingDemo ? "Migrated demo library" : "Migrated browser library",
        conversations: chatsToCanonical(legacy.chats, sourceId, provider),
        warnings: ["Imported from the previous localStorage prototype. Original copy kept as a backup in this browser."],
      });
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) localStorage.setItem(LEGACY_BAK, raw);
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // backup is best-effort
      }
      await setSetting("usingDemo", legacy.usingDemo);
      await setSetting("migratedFromLocalStorage", true);
      return { usingDemo: legacy.usingDemo };
    }

    const sourceId = newId("src");
    await insertImportUnlocked({
      provider: "demo",
      label: "Sample library",
      conversations: chatsToCanonical(DEMO_CHATS, sourceId, "demo"),
      warnings: [],
    });
    await setSetting("usingDemo", true);
    return { usingDemo: true };
  });
}
