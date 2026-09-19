import { createServerFn } from "@tanstack/react-start";
import { CATEGORIES, type AiAnalysis, type Category } from "@/lib/chats/types";

export interface CompactChat {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  messageCount: number;
  userChars: number;
  firstUser: string;
  flags: string[];
}

function asCategory(value: unknown): Category {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) {
    return value as Category;
  }
  return "Other";
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

export const deepAnalyze = createServerFn({ method: "POST" })
  .validator((input: { chats: CompactChat[] }) => {
    if (!input || !Array.isArray(input.chats)) {
      throw new Error("Expected { chats: CompactChat[] }");
    }
    // External xAI only: compact payload. The SQLite archive is not truncated.
    return { chats: input.chats.slice(0, 40) };
  })
  .handler(async ({ data }): Promise<{ ok: true; analysis: AiAnalysis } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "AI is not available in this environment" };

    const payload = data.chats.map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      date: c.createdAt.slice(0, 10),
      messages: c.messageCount,
      userChars: c.userChars,
      excerpt: c.firstUser.slice(0, 280),
      flags: c.flags,
    }));

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 2200,
        messages: [
          {
            role: "system",
            content:
              "You organize a user's Grok chat history. Reply with a single JSON object, no markdown. Be specific and terse. Only reference chat ids from the input.",
          },
          {
            role: "user",
            content: `These are compact records of Grok chats. Produce JSON with this shape:
{
  "overview": "2-4 sentences on the library's shape and clutter",
  "recategorizations": [{"chatId": "...", "category": "Code|Writing|Research|Creative|Travel|Lifestyle|Learning|Planning|Support|Other", "reason": "..."}],
  "summaries": [{"chatId": "...", "summary": "one sentence"}],
  "extraDeletes": [{"chatId": "...", "reason": "..."}],
  "extraMerges": [{"chatIds": ["..."], "reason": "...", "title": "..."}],
  "hybridPlan": ["Keep in Grok: ...", "Archive in Sift: ...", "Delete from Grok: ...", "Rename: ..."],
  "notes": [{"title": "...", "body": "..."}]
}
Rules: recategorize only when the current category is wrong (max 8). Summarize the 12 most worth keeping. extraDeletes = true junk or weaker duplicates. extraMerges = 1-4 groups. hybridPlan = 4-6 actionable bullets mixing Grok-sidebar vs local archive. notes = 2-4 organizational insights.
Chats:
${JSON.stringify(payload)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `xAI API error ${res.status}` };
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text) return { ok: false, error: "Empty model response" };

    try {
      const parsed = extractJson(text) as Record<string, unknown>;
      const recats = Array.isArray(parsed.recategorizations) ? parsed.recategorizations : [];
      const summaries = Array.isArray(parsed.summaries) ? parsed.summaries : [];
      const extraDeletes = Array.isArray(parsed.extraDeletes) ? parsed.extraDeletes : [];
      const extraMerges = Array.isArray(parsed.extraMerges) ? parsed.extraMerges : [];
      const hybridPlan = Array.isArray(parsed.hybridPlan) ? parsed.hybridPlan : [];
      const notes = Array.isArray(parsed.notes) ? parsed.notes : [];

      const analysis: AiAnalysis = {
        generatedAt: new Date().toISOString(),
        overview: String(parsed.overview ?? "").trim() || "No overview returned.",
        recategorizations: recats
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            if (typeof r.chatId !== "string") return null;
            return { chatId: r.chatId, category: asCategory(r.category), reason: String(r.reason ?? "") };
          })
          .filter((r): r is AiAnalysis["recategorizations"][number] => Boolean(r)),
        summaries: summaries
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            if (typeof r.chatId !== "string") return null;
            return { chatId: r.chatId, summary: String(r.summary ?? "") };
          })
          .filter((r): r is AiAnalysis["summaries"][number] => Boolean(r)),
        extraDeletes: extraDeletes
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            if (typeof r.chatId !== "string") return null;
            return { chatId: r.chatId, reason: String(r.reason ?? "") };
          })
          .filter((r): r is AiAnalysis["extraDeletes"][number] => Boolean(r)),
        extraMerges: extraMerges
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            const ids = Array.isArray(r.chatIds) ? r.chatIds.filter((id): id is string => typeof id === "string") : [];
            if (ids.length < 2) return null;
            return { chatIds: ids, reason: String(r.reason ?? ""), title: String(r.title ?? "Merged thread") };
          })
          .filter((r): r is AiAnalysis["extraMerges"][number] => Boolean(r)),
        hybridPlan: hybridPlan.map((line) => String(line)).filter(Boolean).slice(0, 8),
        notes: notes
          .map((row): AiAnalysis["notes"][number] | null => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            const title = String(r.title ?? "Note");
            const body = String(r.body ?? "");
            if (!body) return null;
            const chatId = typeof r.chatId === "string" ? r.chatId : undefined;
            return chatId ? { title, body, chatId } : { title, body };
          })
          .filter((r): r is AiAnalysis["notes"][number] => r !== null),
      };

      return { ok: true, analysis };
    } catch {
      return { ok: false, error: "Could not parse Grok's analysis. Try again." };
    }
  });

export const summarizeChat = createServerFn({ method: "POST" })
  .validator((input: { title: string; transcript: string }) => ({
    // External path only — local archive stores the full transcript.
    title: String(input.title ?? "").slice(0, 200),
    transcript: String(input.transcript ?? "").slice(0, 24_000),
  }))
  .handler(async ({ data }): Promise<{ ok: true; summary: string } | { ok: false; error: string }> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "AI is not available in this environment" };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content: "Summarize a Grok chat for a library card. One sentence, specific, no quotes, no preamble.",
          },
          {
            role: "user",
            content: `Title: ${data.title}\n\n${data.transcript}`,
          },
        ],
      }),
    });

    if (!res.ok) return { ok: false, error: `xAI API error ${res.status}` };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const summary = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!summary) return { ok: false, error: "Empty model response" };
    return { ok: true, summary: summary.slice(0, 280) };
  });
