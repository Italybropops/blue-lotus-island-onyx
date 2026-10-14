import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const REAL = "/workspace/attachments/conversations-20261008_174212-e377898b.json";
const FIXTURE = new URL("./fixtures/perplexity-official.min.json", import.meta.url);

test("perplexity official export, unsupported shape, and the attached library", async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  try {
    const res = await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
    assert.equal(res?.ok(), true);
    await page.waitForTimeout(800);
    const fixture = readFileSync(FIXTURE, "utf8");
    const real = existsSync(REAL) ? readFileSync(REAL) : null;
    const report = await page.evaluate(
      async ({ fixture, realText, realSha }) => {
        const providers = await import("/src/lib/sift/providers/index.ts");
        const repo = await import("/src/lib/sift/repo.ts");
        const sqlite = await import("/src/lib/sift/sqlite.ts");

        const steps = JSON.stringify([
          { slug: "abc", title: "RLHF", steps: [{ step_type: "INITIAL_QUERY", query_str: "Q".repeat(100), final_response: "A" }] },
        ]);
        const stepsBundle = providers.parseWithAdapters(steps, "perplexity-exporter.json");
        const grok = JSON.stringify({
          conversations: [{ id: "g1", title: "Grok", messages: [{ role: "user", content: "hi" }] }],
        });
        const grokId = providers.detectProvider(grok, "library.json").id;

        const bundle = providers.parseWithAdapters(fixture, "conversations-2024-01-02_03-04-05-fixture.json");
        const alpha = bundle.conversations.find((c) => c.sourceConversationId === "ctx-alpha");
        const beta = bundle.conversations.find((c) => c.sourceConversationId === "ctx-beta");

        const first = await repo.insertImport(bundle);
        const second = await repo.insertImport(bundle);
        const loaded = await repo.loadAllConversations();
        const stored = loaded.filter((c) => c.sourceConversationId === "ctx-alpha");
        const bytes = await sqlite.exportSqliteBytes();
        await sqlite.replaceSqlite(bytes);
        const restored = (await repo.loadAllConversations()).find((c) => c.sourceConversationId === "ctx-alpha");

        let realReport = null;
        if (realText) {
          const realBundle = providers.parseWithAdapters(realText, "conversations-20261008_174212-e377898b.json");
          const entries = realBundle.conversations.reduce((n, c) => n + Math.round(c.messages.length / 2), 0);
          const queryChars = realBundle.conversations.reduce(
            (n, c) => n + c.messages.filter((m) => m.metadata.part === "query").reduce((s, m) => s + m.content.length, 0),
            0,
          );
          const answerChars = realBundle.conversations.reduce(
            (n, c) => n + c.messages.filter((m) => m.metadata.part === "answer").reduce((s, m) => s + m.content.length, 0),
            0,
          );
          const source = JSON.parse(realText);
          let expectedQuery = 0;
          let expectedAnswer = 0;
          let expectedEntries = 0;
          const ids = [];
          for (const conv of source.conversations) {
            ids.push(conv.context_uuid);
            for (const entry of conv.entries) {
              expectedEntries += 1;
              expectedQuery += entry.query.length;
              expectedAnswer += entry.answer.length;
            }
          }
          const gotIds = realBundle.conversations.map((c) => c.sourceConversationId);
          const orderOk = ids.every((id, i) => gotIds[i] === id);
          const firstConv = source.conversations[0];
          const parsedFirst = realBundle.conversations[0];
          const turnOrder = parsedFirst.messages.map((m) => `${m.metadata.part}:${m.sourceMessageId}:${m.timestamp}`);
          const expectedTurns = [];
          for (const entry of firstConv.entries) {
            expectedTurns.push(`query:${entry.entry_uuid}:${entry.created_at}`);
            expectedTurns.push(`answer:${entry.entry_uuid}:${entry.created_at}`);
          }
          realReport = {
            provider: realBundle.provider,
            parser: realBundle.parserVersion,
            conversations: realBundle.conversations.length,
            messages: realBundle.conversations.reduce((n, c) => n + c.messages.length, 0),
            entries,
            skipped: realBundle.skipped.length,
            failed: realBundle.failed.length,
            citations: realBundle.conversations.reduce(
              (n, c) => n + c.messages.reduce((m, msg) => m + msg.attachments.length, 0),
              0,
            ),
            queryChars,
            answerChars,
            expectedQuery,
            expectedAnswer,
            expectedEntries,
            orderOk,
            turnOrderOk: JSON.stringify(turnOrder) === JSON.stringify(expectedTurns),
            createdAt: parsedFirst.createdAt,
            expectedCreated: firstConv.created_at,
            updatedAt: parsedFirst.updatedAt,
            mode: parsedFirst.metadata.mode,
            titled: parsedFirst.title === firstConv.context_title,
            rawShaMatches: realSha,
            notGrok: realBundle.provider !== "grok" && realBundle.provider !== "generic",
          };
        }

        return {
          steps: {
            provider: stepsBundle.provider,
            chats: stepsBundle.conversations.length,
            failed: stepsBundle.failed.length,
          },
          grokId,
          fixture: {
            provider: bundle.provider,
            parser: bundle.parserVersion,
            chats: bundle.conversations.length,
            alphaMessages: alpha?.messages.length,
            alphaQuery: alpha?.messages[0]?.content,
            alphaCreated: alpha?.createdAt,
            alphaUpdated: alpha?.updatedAt,
            alphaId: alpha?.sourceConversationId,
            followParent: alpha?.messages[2]?.parentSourceId,
            citation: alpha?.messages[3]?.attachments[0]?.url,
            citationAvailability: alpha?.messages[3]?.attachments[0]?.availability,
            mode: alpha?.metadata.mode,
            collection: alpha?.metadata.collection_uuid,
            betaAnswerLen: beta?.messages[1]?.content.length,
            betaCreated: beta?.createdAt,
          },
          duplicate: {
            first: first.inserted,
            second: second.inserted,
            links: second.exactDuplicateLinks,
            stored: stored.length,
            restoredQuery: restored?.messages[0]?.content,
            restoredCitation: restored?.messages[3]?.attachments[0]?.url,
            header: String.fromCharCode(...bytes.slice(0, 15)),
          },
          realReport,
        };
      },
      { fixture, realText: real ? real.toString("utf8") : null, realSha: real ? createHash("sha256").update(real).digest("hex") : null },
    );

    assert.equal(report.steps.provider, "perplexity");
    assert.equal(report.steps.chats, 0);
    assert.ok(report.steps.failed >= 1);
    assert.equal(report.grokId, "grok");
    assert.equal(report.fixture.provider, "perplexity");
    assert.equal(report.fixture.parser, "perplexity@1");
    assert.equal(report.fixture.chats, 2);
    assert.equal(report.fixture.alphaMessages, 4);
    assert.equal(report.fixture.alphaQuery, "First question\r\nwith a line break");
    assert.equal(report.fixture.alphaCreated, "2024-01-02T03:04:05.000000Z");
    assert.equal(report.fixture.alphaId, "ctx-alpha");
    assert.equal(report.fixture.followParent, "ent-a1");
    assert.equal(report.fixture.citation, "https://example.com/a");
    assert.equal(report.fixture.citationAvailability, "reference");
    assert.equal(report.fixture.mode, "COPILOT");
    assert.equal(report.fixture.collection, "col-1");
    assert.equal(report.fixture.betaAnswerLen, 0);
    assert.equal(report.duplicate.stored, 2);
    assert.equal(report.duplicate.links, 2);
    assert.equal(report.duplicate.restoredQuery, "First question\r\nwith a line break");
    assert.equal(report.duplicate.restoredCitation, "https://example.com/a");
    assert.equal(report.duplicate.header, "SQLite format 3");

    if (report.realReport) {
      assert.equal(report.realReport.provider, "perplexity");
      assert.equal(report.realReport.parser, "perplexity@1");
      assert.equal(report.realReport.conversations, 75);
      assert.equal(report.realReport.entries, 97);
      assert.equal(report.realReport.messages, 194);
      assert.equal(report.realReport.queryChars, report.realReport.expectedQuery);
      assert.equal(report.realReport.answerChars, report.realReport.expectedAnswer);
      assert.equal(report.realReport.orderOk, true);
      assert.equal(report.realReport.turnOrderOk, true);
      assert.equal(report.realReport.createdAt, report.realReport.expectedCreated);
      assert.equal(report.realReport.titled, true);
      assert.equal(report.realReport.citations, 0);
      assert.equal(report.realReport.failed, 0);
      assert.equal(report.realReport.skipped, 0);
      assert.equal(report.realReport.notGrok, true);
      assert.equal(report.realReport.rawShaMatches, "47335da9e225259ba2e43aabfd51a9fdb51af0f58ff3f62c835947d364b4902c");
    }
  } finally {
    await browser.close();
  }
});
