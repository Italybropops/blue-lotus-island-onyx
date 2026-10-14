import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

test("live parsers and sqlite preserve scale, branches, raw hash, restore", async (t) => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  try {
    const res = await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
    assert.equal(res?.ok(), true);
    await page.waitForTimeout(2000);

    const report = await page.evaluate(async () => {
      const parseMod = await import("/src/lib/chats/parse.ts");
      const chatgpt = await import("/src/lib/sift/providers/chatgpt.ts");
      const hash = await import("/src/lib/sift/hash.ts");
      const repo = await import("/src/lib/sift/repo.ts");
      const sqlite = await import("/src/lib/sift/sqlite.ts");
      const blobs = await import("/src/lib/sift/blob-store.ts");
      const view = await import("/src/lib/sift/view.ts");

      const grokArray = {
        conversations: Array.from({ length: 600 }, (_, i) => ({
          id: `grok-${i}`,
          title: `Grok chat ${i}`,
          created_at: 1710000000 + i,
          messages: [
            { id: `gm-${i}`, sender: "user", content: `Question ${i} UNIQUE-${i}`, create_time: 1710000000 },
            { sender: "assistant", content: `Answer ${i}` },
          ],
        })),
      };
      const parsed600 = parseMod.parseImport(JSON.stringify(grokArray));

      const dict = {};
      for (let i = 0; i < 600; i++) {
        dict[`c${i}`] = { title: `Dict chat ${i}`, messages: [{ role: "user", content: `Dict ${i} UNIQUE-DICT-${i}` }] };
      }
      const parsedDict = parseMod.parseImport(JSON.stringify(dict));

      const big = {
        conversations: Array.from({ length: 10500 }, (_, i) => ({
          title: `N${i}`,
          messages: [{ role: "user", content: `body ${i}` }],
        })),
      };
      const parsedBig = parseMod.parseImport(JSON.stringify(big));

      const long = "Q".repeat(20000);
      const longParsed = parseMod.parseImport(
        JSON.stringify({
          conversations: [{ id: "long-id", title: "Long", create_time: 1710000000, messages: [{ role: "user", content: long }] }],
        }),
      );

      const gpt = {
        id: "conv-source-id",
        title: "GPT thread",
        create_time: 1710000000,
        current_node: "a1",
        mapping: {
          sys: { id: "sys", parent: null, message: { author: { role: "system" }, content: { parts: ["sys"] } } },
          u1: {
            id: "u1",
            parent: "sys",
            message: {
              id: "mu",
              author: { role: "user" },
              create_time: 1710000000,
              content: { content_type: "multimodal_text", parts: ["hello", { content_type: "image_asset_pointer", asset_pointer: "file-abc" }] },
            },
          },
          a1: {
            id: "a1",
            parent: "u1",
            message: { id: "ma", author: { role: "assistant" }, create_time: 1710000001, content: { parts: ["reply"] } },
          },
          u1b: {
            id: "u1b",
            parent: "sys",
            message: { id: "mub", author: { role: "user" }, content: { parts: ["THIS BRANCH MUST SURVIVE"] } },
          },
        },
      };
      const gptBundle = chatgpt.chatgptAdapter.parse(JSON.stringify([gpt]), "conversations.json");
      const gptConv = gptBundle.conversations[0];

      const raw = new TextEncoder().encode(JSON.stringify(grokArray));
      const fullHash = await hash.sha256Bytes(raw);
      const prefixHash = await hash.sha256Bytes(raw.slice(0, Math.min(raw.length, 100)));

      const marker = "INTEGRITY-" + Date.now();
      const grokAdapter = await import("/src/lib/sift/providers/generic.ts");
      const bundle = grokAdapter.bundleFromText(
        JSON.stringify({
          conversations: [
            {
              id: "prov-1",
              title: marker,
              created_at: 1711111111,
              messages: [
                { id: "pm1", role: "user", content: "KEEP-FULL-" + "W".repeat(18000), create_time: 1711111111 },
                { role: "assistant", content: "second" },
              ],
            },
          ],
        }),
        { provider: "grok", label: "audit", filename: "prod-grok-backend.json", mime: "application/json" },
      );
      const ins1 = await repo.insertImport(bundle);
      const ins2 = await repo.insertImport(bundle);
      const after = await repo.loadAllConversations();
      const copies = after.filter((c) => c.title === marker);
      const stored = copies[0];
      const viewChat = stored ? view.toViewChat(stored) : null;

      const gptIns = await repo.insertImport(gptBundle);
      const gptStored = (await repo.loadAllConversations()).find((c) => c.sourceConversationId === "conv-source-id");

      const bytes = await sqlite.exportSqliteBytes();
      await sqlite.replaceSqlite(bytes);
      const restored = (await repo.loadAllConversations()).find((c) => c.title === marker);
      const validation = await repo.archiveStats();
      const fk = sqlite.foreignKeysEnabled(await sqlite.openSqlite());

      let rawPresent = false;
      if (ins1.sourceId) {
        const sources = await repo.listSources();
        const src = sources.find((s) => s.id === ins1.sourceId);
        rawPresent = Boolean(src?.rawRetained && src.rawSha256 && src.rawSha256.length === 64 && src.parserVersion);
      }

      const hidden = stored ? await (async () => {
        await repo.updateConversation(stored.id, { state: "low_value" });
        const row = (await repo.loadAllConversations()).find((c) => c.id === stored.id);
        return { state: row?.state, len: row?.messages[0]?.content.length };
      })() : null;

      return {
        grokArray600: parsed600.length,
        grokDict600: parsedDict.length,
        grokArray10500: parsedBig.length,
        longChars: longParsed[0]?.messages[0]?.content.length,
        grokSourceId: parsed600[0]?.sourceConversationId,
        grokMsgTs: parsed600[0]?.messages[0]?.timestamp,
        gptNodes: gptConv?.messages.length,
        gptBranch: gptConv?.messages.some((m) => m.content.includes("THIS BRANCH MUST SURVIVE")),
        gptCurrentPath: gptConv?.messages.filter((m) => m.isOnCurrentPath).length,
        gptAttachment: gptConv?.messages.find((m) => m.attachments?.length)?.attachments[0]?.availability,
        gptParser: gptBundle.parserVersion,
        fullHashLen: fullHash.length,
        hashesDiffer: fullHash !== prefixHash,
        inserted: ins1.inserted,
        secondInserted: ins2.inserted,
        copies: copies.length,
        exactLinks: ins2.exactDuplicateLinks,
        storedLen: stored?.messages[0]?.content.length,
        storedSourceConv: stored?.sourceConversationId,
        viewKeepsTs: Boolean(viewChat?.messages[0]?.timestamp),
        viewKeepsAtt: (viewChat?.messages[0]?.attachments?.length ?? 0) >= 0,
        gptLoadedAtt: gptStored?.messages.flatMap((m) => m.attachments).length,
        gptLoadedBranch: gptStored?.messages.some((m) => m.content.includes("THIS BRANCH MUST SURVIVE")),
        restoredLen: restored?.messages[0]?.content.length,
        restoredParser: restored?.parserVersion,
        fk,
        schema: validation.schemaVersion,
        rawPresent,
        rawRetained: ins1.rawRetained,
        persistOk: ins1.persistOk,
        hidden,
        gptIns: gptIns.inserted,
        sqliteHeader: String.fromCharCode(...bytes.slice(0, 15)),
        blobBackend: await blobs.blobBackend(),
      };
    });

    assert.equal(report.grokArray600, 600, "600-array");
    assert.equal(report.grokDict600, 600, "600-dict must not cap at 500");
    assert.equal(report.grokArray10500, 10500, "10500 must not cap at 10000");
    assert.equal(report.longChars, 20000);
    assert.equal(report.grokSourceId, "grok-0");
    assert.ok(report.gptBranch, "ChatGPT unused branch kept");
    assert.equal(report.gptAttachment, "reference");
    assert.equal(report.gptParser, "chatgpt@2");
    assert.equal(report.copies, 2);
    assert.equal(report.exactLinks, 1);
    assert.equal(report.storedLen, 18010);
    assert.equal(report.restoredLen, 18010);
    assert.equal(report.fk, true);
    assert.equal(report.schema, "2");
    assert.equal(report.sqliteHeader, "SQLite format 3");
    assert.equal(report.hidden.state, "low_value");
    assert.equal(report.hidden.len, 18010);
    assert.equal(report.persistOk, true);
    assert.ok(report.rawPresent);
    assert.ok(report.gptLoadedBranch);
    assert.ok(report.gptLoadedAtt >= 1);
    t.diagnostic(JSON.stringify(report));
  } finally {
    await browser.close();
  }
});
