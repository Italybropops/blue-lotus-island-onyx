import type {
  Analysis,
  Category,
  Chat,
  DeleteSuggestion,
  DuplicateGroup,
  MergeSuggestion,
  OrgSuggestion,
  RenameSuggestion,
  RepeatTopic,
} from "./types";
import { CATEGORIES } from "./types";
import { allText, charCount, tokenize, userText } from "./parse";

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  Code: [
    "typescript",
    "javascript",
    "python",
    "react",
    "query",
    "error",
    "debug",
    "vite",
    "function",
    "swift",
    "docker",
    "pandas",
    "code",
    "hook",
    "compile",
    "hmr",
    "stack",
    "github",
    "npm",
    "sql",
    "api",
    "bug",
    "css",
    "html",
    "terminal",
  ],
  Writing: ["email", "letter", "rewrite", "tone", "draft", "resignation", "warmer", "professional", "copy", "headline", "bio"],
  Research: ["hypothesis", "history", "compare", "briefing", "versus", "vs", "paper", "sources", "cite"],
  Creative: ["image", "prompt", "cinematic", "illustration", "story", "poem", "character", "scene", "midjourney"],
  Travel: ["itinerary", "trip", "temple", "flight", "hotel", "weekend", "airport", "visa", "packing", "kyoto", "tokyo"],
  Lifestyle: ["protein", "meal", "espresso", "gym", "recipe", "coffee", "diet", "sleep", "workout"],
  Learning: ["explain", "transformer", "quantum", "entanglement", "attention", "tutorial", "concept"],
  Planning: ["plan", "spec", "habit", "budget", "tracker", "roadmap", "checklist"],
  Support: ["macos", "safari", "pwa", "desktop", "install", "stuck", "crash", "settings", "m2", "macbook"],
  Other: [],
};

const CLUTTER_TITLES = /^(hi|hey|hello|test|ok|okay|thanks|thank you|asdf|yo|sup|hmm+|lol)$/i;

const GENERIC_PHRASES = new Set([
  "let me",
  "not sure",
  "one more",
  "next step",
  "make sure",
  "looks like",
  "something else",
]);

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((v, k) => {
    na += v * v;
    const bv = b.get(k);
    if (bv) dot += v * bv;
  });
  b.forEach((v) => {
    nb += v * v;
  });
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  sa.forEach((t) => {
    if (sb.has(t)) inter += 1;
  });
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function vector(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

function ngrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

function titleCase(phrase: string): string {
  return phrase.replace(/\b[a-z0-9]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function inferCategory(chat: Chat): Category {
  const text = allText(chat).toLowerCase();
  let best: Category = "Other";
  let bestScore = 0;
  for (const cat of CATEGORIES) {
    if (cat === "Other") continue;
    let score = 0;
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return bestScore >= 1 ? best : "Other";
}

export function isClutter(chat: Chat): boolean {
  const user = userText(chat).trim();
  const title = chat.title.trim();
  if (CLUTTER_TITLES.test(title) || CLUTTER_TITLES.test(user)) return true;
  if (!title && user.length < 12) return true;
  if (charCount(chat) < 12 && title.length < 12) return true;
  return false;
}

function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function unionFind(pairs: [string, string][]): string[][] {
  const parent = new Map<string, string>();
  const ensure = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };
  const find = (id: string): string => {
    ensure(id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  };
  const union = (a: string, b: string) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  for (const [a, b] of pairs) union(a, b);
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function extractRepeatTopics(active: Chat[]): RepeatTopic[] {
  const phraseToIds = new Map<string, Set<string>>();
  for (const c of active) {
    if (isClutter(c)) continue;
    const titleToks = tokenize(c.title);
    const phrases = new Set([...ngrams(titleToks, 2), ...ngrams(titleToks, 3)]);
    for (const p of phrases) {
      if (GENERIC_PHRASES.has(p)) continue;
      const set = phraseToIds.get(p) ?? new Set<string>();
      set.add(c.id);
      phraseToIds.set(p, set);
    }
  }

  const ranked = [...phraseToIds.entries()]
    .filter(([, ids]) => ids.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);

  const covered = new Set<string>();
  const topics: RepeatTopic[] = [];
  const byId = new Map(active.map((c) => [c.id, c]));

  for (const [label, ids] of ranked) {
    const chatIds = [...ids];
    if (chatIds.every((id) => covered.has(id))) continue;
    const tally = new Map<Category, number>();
    for (const id of chatIds) {
      const cat = byId.get(id)?.category ?? "Other";
      tally.set(cat, (tally.get(cat) ?? 0) + 1);
    }
    const category = ([...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other") as Category;
    topics.push({ label: titleCase(label), chatIds, category });
    chatIds.forEach((id) => covered.add(id));
    if (topics.length >= 8) break;
  }

  if (topics.length === 0) {
    const topicMap = new Map<string, RepeatTopic>();
    for (const c of active) {
      if (isClutter(c)) continue;
      const existing = topicMap.get(c.category);
      if (existing) existing.chatIds.push(c.id);
      else topicMap.set(c.category, { label: c.category, chatIds: [c.id], category: c.category });
    }
    return [...topicMap.values()]
      .filter((t) => t.chatIds.length >= 2)
      .sort((a, b) => b.chatIds.length - a.chatIds.length);
  }

  return topics;
}

function suggestTitle(chat: Chat): string {
  const raw = chat.title.trim();
  const user = userText(chat).replace(/\s+/g, " ").trim();
  const source = raw.length >= 8 && !CLUTTER_TITLES.test(raw) ? raw : user;
  let core = source.replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  if (core.length > 46) core = `${core.slice(0, 46).replace(/\s+\S*$/, "")}…`;
  if (!core) return `${chat.category} · Untitled`;
  if (core.toLowerCase().startsWith(chat.category.toLowerCase())) return core;
  if (core.includes(" · ")) return core;
  return `${chat.category} · ${core}`;
}

export function analyzeChats(chats: Chat[]): Analysis {
  const active = chats.filter((c) => c.status === "active");
  const clutterIds = active.filter(isClutter).map((c) => c.id);

  const byId = new Map(active.map((c) => [c.id, c]));

  const exactMap = new Map<string, string[]>();
  for (const c of active) {
    const key =
      c.contentSha256 ||
      c.messages.map((m) => `${m.role}\n${m.content.replace(/\r\n/g, "\n").trim()}`).join("\n\u001e\n");
    if (!key) continue;
    const list = exactMap.get(key) ?? [];
    list.push(c.id);
    exactMap.set(key, list);
  }
  const exactGroups: DuplicateGroup[] = [];
  let exactI = 0;
  const exactCovered = new Set<string>();
  for (const ids of exactMap.values()) {
    if (ids.length < 2) continue;
    const ranked = [...ids].sort((x, y) => charCount(byId.get(y)!) - charCount(byId.get(x)!));
    exactGroups.push({
      id: `exact-${++exactI}`,
      chatIds: ranked,
      score: 1,
      keepId: ranked[0],
      kind: "exact",
      reason: `Exact duplicate (${ranked.length} copies of the same text). Both records stay in the archive; hide extras if you want a cleaner list.`,
    });
    ranked.forEach((id) => exactCovered.add(id));
  }

  const vecs = new Map<string, Map<string, number>>();
  const titleToks = new Map<string, string[]>();
  for (const c of active) {
    vecs.set(c.id, vector(`${c.title}\n${userText(c)}`));
    titleToks.set(c.id, tokenize(c.title));
  }

  const dupPairs: [string, string][] = [];
  const near: { a: string; b: string; score: number }[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (exactCovered.has(a.id) && exactCovered.has(b.id)) continue;
      const cos = cosine(vecs.get(a.id)!, vecs.get(b.id)!);
      const jac = jaccard(titleToks.get(a.id)!, titleToks.get(b.id)!);
      const score = cos * 0.72 + jac * 0.28;
      if (score >= 0.46) {
        near.push({ a: a.id, b: b.id, score });
        if (score >= 0.58) dupPairs.push([a.id, b.id]);
      }
    }
  }

  const nearGroups: DuplicateGroup[] = unionFind(dupPairs).map((chatIds, i) => {
    const ranked = [...chatIds].sort((x, y) => charCount(byId.get(y)!) - charCount(byId.get(x)!));
    const keepId = ranked[0];
    const avg =
      near
        .filter((n) => chatIds.includes(n.a) && chatIds.includes(n.b))
        .reduce((s, n) => s + n.score, 0) / Math.max(1, chatIds.length - 1);
    return {
      id: `dup-${i + 1}`,
      chatIds: ranked,
      score: avg,
      keepId,
      kind: "near" as const,
      reason: `Nearly the same question across ${ranked.length} chats. Keep the longest thread; extras can be hidden, not erased.`,
    };
  });

  const dupGroups: DuplicateGroup[] = [...exactGroups, ...nearGroups];

  const covered = new Set(dupGroups.flatMap((g) => g.chatIds));
  const mergeSuggestions: MergeSuggestion[] = [];

  const nearUnused = near.filter((n) => !covered.has(n.a) || !covered.has(n.b));
  const mergePairs: [string, string][] = nearUnused.filter((n) => n.score >= 0.46).map((n) => [n.a, n.b]);
  unionFind(mergePairs).forEach((chatIds, i) => {
    if (chatIds.some((id) => clutterIds.includes(id))) return;
    const items = chatIds.map((id) => byId.get(id)!);
    const cats = new Set(items.map((c) => c.category));
    if (cats.size > 2) return;
    const title = items.sort((a, b) => charCount(b) - charCount(a))[0].title;
    mergeSuggestions.push({
      id: `merge-${i + 1}`,
      chatIds,
      score: 0.5,
      title: `Merge: ${title}`,
      reason:
        cats.size === 1
          ? `Same topic (${[...cats][0]}). Combining keeps one canonical thread.`
          : "Overlapping questions. One merged thread is easier to find later.",
    });
  });

  dupGroups.forEach((g, i) => {
    if (g.chatIds.length < 2) return;
    if (mergeSuggestions.some((m) => m.chatIds.join() === g.chatIds.join())) return;
    mergeSuggestions.unshift({
      id: `merge-dup-${i + 1}`,
      chatIds: g.chatIds,
      score: g.score,
      title: `Merge duplicates: ${byId.get(g.keepId)?.title ?? "thread"}`,
      reason: g.reason,
    });
  });

  const deleteSuggestions: DeleteSuggestion[] = [];
  for (const id of clutterIds) {
    deleteSuggestions.push({
      chatId: id,
      reason: "Greeting, test, or too short to be worth keeping in Grok.",
      severity: "clutter",
    });
  }
  for (const g of dupGroups) {
    for (const id of g.chatIds) {
      if (id === g.keepId) continue;
      if (deleteSuggestions.some((d) => d.chatId === id)) continue;
      deleteSuggestions.push({
        chatId: id,
        reason: `Weaker copy of “${byId.get(g.keepId)?.title ?? "another chat"}”.`,
        severity: "duplicate",
      });
    }
  }
  for (const c of active) {
    if (clutterIds.includes(c.id)) continue;
    if (deleteSuggestions.some((d) => d.chatId === c.id)) continue;
    if (c.pinned) continue;
    if (c.messages.length <= 2 && charCount(c) < 220 && daysAgo(c.updatedAt) > 60) {
      deleteSuggestions.push({
        chatId: c.id,
        reason: "Short and untouched for two months — likely a one-off.",
        severity: "stale",
      });
    }
  }

  const repeatTopics = extractRepeatTopics(active);

  const scored = [...active].sort((a, b) => {
    const pin = Number(b.pinned) - Number(a.pinned);
    if (pin) return pin;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const workingSetIds = scored
    .filter((c) => !clutterIds.includes(c.id) && !deleteSuggestions.some((d) => d.chatId === c.id && d.severity !== "stale"))
    .slice(0, 10)
    .map((c) => c.id);
  const archiveIds = active
    .filter((c) => !workingSetIds.includes(c.id) && !clutterIds.includes(c.id) && !deleteSuggestions.some((d) => d.chatId === c.id))
    .map((c) => c.id);

  const renameSuggestions: RenameSuggestion[] = active
    .filter((c) => !isClutter(c))
    .map((c) => {
      const suggested = suggestTitle(c);
      if (suggested === c.title) return null;
      return {
        chatId: c.id,
        suggested,
        reason: "Topic first, so the Grok sidebar scans in one glance.",
      };
    })
    .filter((r): r is RenameSuggestion => Boolean(r))
    .slice(0, 16);

  const orgSuggestions: OrgSuggestion[] = [
    {
      id: "org-folders",
      kind: "folder",
      title: "Prefix titles if Grok has no folders",
      detail: repeatTopics.length
        ? `Use topic-first names so the sidebar clusters: ${repeatTopics
            .slice(0, 5)
            .map((t) => `${t.category} ·`)
            .join(" ")}. Leave one-offs unprefixed.`
        : "Grok’s sidebar is recency, not folders. Prefix the keepers: Code ·, Travel · — extra prefixes become clutter.",
      chatIds: [],
    },
    {
      id: "org-naming",
      kind: "naming",
      title: "Rename with topic first",
      detail: renameSuggestions.length
        ? `Pattern: Topic · short outcome. ${renameSuggestions.length} chats would scan faster with that shape.`
        : "Pattern: Topic · short outcome. Example: “Code · React Query types”. Names are how you scan; Grok still sorts by recency.",
      chatIds: renameSuggestions.map((r) => r.chatId),
    },
    {
      id: "org-hybrid",
      kind: "hybrid",
      title: "Hybrid: a short Grok sidebar, the rest in Sift",
      detail: `Keep ${workingSetIds.length} working chats in grok.com or the Safari Dock app (pinned or recently used). Park ${archiveIds.length} reference threads here. Delete ${deleteSuggestions.length} so the list can breathe.`,
      chatIds: workingSetIds,
    },
    {
      id: "org-pin",
      kind: "pin",
      title: "Pin the long research threads",
      detail:
        "Anything you’d reread — trip plans, specs, type history — should be pinned in Grok and here. One-offs don’t get a pin.",
      chatIds: active.filter((c) => c.pinned || c.messages.length >= 4).map((c) => c.id),
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    duplicateGroups: dupGroups,
    mergeSuggestions,
    deleteSuggestions,
    orgSuggestions,
    renameSuggestions,
    repeatTopics,
    clutterIds,
    workingSetIds,
    archiveIds,
  };
}

export function applyInferredCategories(chats: Chat[]): Chat[] {
  return chats.map((c) => {
    if (c.source === "import" && c.category === "Other") {
      return { ...c, category: inferCategory(c) };
    }
    if (c.source === "demo") return c;
    if (c.category === "Other") return { ...c, category: inferCategory(c) };
    return c;
  });
}

export function formatChecklist(chats: Chat[], analysis: Analysis): string {
  const byId = new Map(chats.map((c) => [c.id, c]));
  const lines: string[] = [
    "# Sift cleanup plan for Grok",
    "",
    "Work through this in grok.com or the Grok Mac app. Sift cannot delete chats on Grok’s servers — this is your checklist.",
    "",
    "## Delete in Grok",
    "",
  ];
  for (const d of analysis.deleteSuggestions) {
    const c = byId.get(d.chatId);
    if (!c) continue;
    lines.push(`- [ ] ${c.title} — ${d.reason}`);
  }
  lines.push("", "## Merge (open both, keep one, delete the extra)", "");
  for (const m of analysis.mergeSuggestions) {
    const titles = m.chatIds.map((id) => byId.get(id)?.title).filter(Boolean);
    lines.push(`- [ ] ${titles.join(" + ")}`);
    lines.push(`      ${m.reason}`);
  }
  lines.push("", "## Rename in Grok", "");
  for (const r of analysis.renameSuggestions) {
    const c = byId.get(r.chatId);
    if (!c) continue;
    lines.push(`- [ ] ${c.title} → ${r.suggested}`);
  }
  lines.push("", "## Keep in the Grok sidebar (working set)", "");
  for (const id of analysis.workingSetIds) {
    const c = byId.get(id);
    if (c) lines.push(`- ${c.title}`);
  }
  lines.push("", "## Hybrid organization", "");
  for (const o of analysis.orgSuggestions) {
    lines.push(`- ${o.title}: ${o.detail}`);
  }
  lines.push("");
  return lines.join("\n");
}
