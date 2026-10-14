import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

function conversationHashInput(messages) {
  return messages.map((m) => `${m.role}\n${normalizeText(m.content)}`).join("\n\u001e\n");
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("sha256 known vector", () => {
  assert.equal(sha256Hex("sift"), "cda9593e0f0c88ba636fcadbae02ae65ce6847109ccaa81c077e32358700a6c3");
});

test("exact duplicates share a hash; whitespace-normalized", () => {
  const a = conversationHashInput([
    { role: "user", content: "Hello\r\nworld" },
    { role: "assistant", content: "Hi" },
  ]);
  const b = conversationHashInput([
    { role: "user", content: "Hello\nworld" },
    { role: "assistant", content: "Hi" },
  ]);
  assert.equal(sha256Hex(a), sha256Hex(b));
  const c = conversationHashInput([
    { role: "user", content: "Hello world" },
    { role: "assistant", content: "Hi" },
  ]);
  assert.notEqual(sha256Hex(a), sha256Hex(c));
});

test("ChatGPT mapping linearizes parent chain and keeps full text", () => {
  const mapping = {
    sys: { id: "sys", parent: null, message: { author: { role: "system" }, content: { parts: ["ignore"] } } },
    u1: {
      id: "u1",
      parent: "sys",
      message: {
        id: "mu",
        author: { role: "user" },
        content: { parts: ["x".repeat(20_000)] },
        create_time: 1710000000,
      },
    },
    a1: {
      id: "a1",
      parent: "u1",
      message: { id: "ma", author: { role: "assistant" }, content: { parts: ["ok"] }, create_time: 1710000001 },
    },
  };
  const chain = [];
  let id = "a1";
  const guard = new Set();
  while (id && mapping[id] && !guard.has(id)) {
    guard.add(id);
    chain.push(mapping[id]);
    id = mapping[id].parent ?? undefined;
  }
  chain.reverse();
  const texts = chain
    .filter((n) => n.message && n.message.author.role !== "system")
    .map((n) => n.message.content.parts.join(""));
  assert.equal(texts[0].length, 20_000);
  assert.equal(texts[1], "ok");
});

test("sqlite schema stores full message content and duplicate links", async () => {
  const schema = readFileSync(new URL("../src/lib/sift/schema.sql", import.meta.url), "utf8");
  const wasmBinary = readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
  const SQL = await initSqlJs({ wasmBinary });
  const db = new SQL.Database();
  db.exec(schema);
  const long = "Q".repeat(20_000);
  const hash = sha256Hex(`user\n${long}`);
  db.run(
    `INSERT INTO sources (id, provider, label, imported_at, parser, parser_version) VALUES (?, ?, ?, ?, ?, ?)`,
    ["src1", "chatgpt", "fixture", new Date().toISOString(), "chatgpt", "chatgpt@2"],
  );
  db.run(
    `INSERT INTO conversations (id, source_id, title, imported_at, content_sha256, processing_stage, message_count, char_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["c1", "src1", "Long", new Date().toISOString(), hash, "hashed", 1, long.length],
  );
  db.run(`INSERT INTO messages (id, conversation_id, role, content, sort_index, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`, [
    "m1",
    "c1",
    "user",
    long,
    0,
    hash,
  ]);
  db.run(
    `INSERT INTO conversations (id, source_id, title, imported_at, content_sha256, processing_stage, message_count, char_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["c2", "src1", "Long copy", new Date().toISOString(), hash, "hashed", 1, long.length],
  );
  db.run(
    `INSERT INTO relationships (id, kind, from_id, to_id, score, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["rel1", "exact_duplicate", "c2", "c1", 1, "same hash", new Date().toISOString()],
  );
  const stored = db.exec("SELECT length(content) AS n FROM messages WHERE id = 'm1'");
  assert.equal(Number(stored[0].values[0][0]), 20_000);
  const stmt = db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE content_sha256 = ?");
  stmt.bind([hash]);
  stmt.step();
  assert.equal(Number(stmt.getAsObject().n), 2);
  stmt.free();
  const rel = db.exec("SELECT kind FROM relationships");
  assert.equal(rel[0].values[0][0], "exact_duplicate");
  db.close();
});

test("reused message ids collide unless the importer mints a new primary key", async () => {
  const schema = readFileSync(new URL("../src/lib/sift/schema.sql", import.meta.url), "utf8");
  const wasmBinary = readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
  const SQL = await initSqlJs({ wasmBinary });
  const db = new SQL.Database();
  db.exec(schema);
  db.run(
    `INSERT INTO sources (id, provider, label, imported_at, parser, parser_version) VALUES (?, ?, ?, ?, ?, ?)`,
    ["src1", "demo", "fixture", new Date().toISOString(), "demo", "demo@1"],
  );
  db.run(`INSERT INTO conversations (id, source_id, title, imported_at, content_sha256, processing_stage) VALUES (?, ?, ?, ?, ?, ?)`, [
    "c1",
    "src1",
    "A",
    new Date().toISOString(),
    "h1",
    "hashed",
  ]);
  db.run(`INSERT INTO messages (id, conversation_id, role, content, sort_index, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`, [
    "m-0",
    "c1",
    "user",
    "hello",
    0,
    "x",
  ]);
  db.run(`INSERT INTO conversations (id, source_id, title, imported_at, content_sha256, processing_stage) VALUES (?, ?, ?, ?, ?, ?)`, [
    "c2",
    "src1",
    "B",
    new Date().toISOString(),
    "h2",
    "hashed",
  ]);
  assert.throws(() => {
    db.run(`INSERT INTO messages (id, conversation_id, role, content, sort_index, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`, [
      "m-0",
      "c2",
      "user",
      "other",
      0,
      "y",
    ]);
  });
  db.run(`INSERT INTO messages (id, conversation_id, role, content, sort_index, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`, [
    "m-c2-0",
    "c2",
    "user",
    "other",
    0,
    "y",
  ]);
  const n = db.exec("SELECT COUNT(*) FROM messages");
  assert.equal(Number(n[0].values[0][0]), 2);
  db.close();
});
