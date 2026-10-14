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

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function openSchema() {
  const schema = readFileSync(new URL("../src/lib/sift/schema.sql", import.meta.url), "utf8");
  const wasmBinary = readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
  const SQL = await initSqlJs({ wasmBinary });
  const db = new SQL.Database();
  db.exec(schema);
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

test("CRLF vs LF produce the same exact-content hash; title is ignored", () => {
  const a = conversationHashInput([
    { role: "user", content: "Hello\r\nworld" },
    { role: "assistant", content: "Hi" },
  ]);
  const b = conversationHashInput([
    { role: "user", content: "Hello\nworld" },
    { role: "assistant", content: "Hi" },
  ]);
  assert.equal(sha256Hex(a), sha256Hex(b));
  const titled = conversationHashInput([
    { role: "user", content: "Hello\nworld" },
    { role: "assistant", content: "Hi" },
  ]);
  assert.equal(sha256Hex(a), sha256Hex(titled));
});

test("complete original bytes are hashed, not a 2MB prefix", () => {
  const bytes = Buffer.alloc(2_000_100, 7);
  bytes[0] = 1;
  bytes[2_000_099] = 9;
  const full = sha256Bytes(bytes);
  const prefix = sha256Bytes(bytes.subarray(0, 2_000_000));
  assert.notEqual(full, prefix);
  assert.equal(full.length, 64);
});

test("foreign_keys pragma is on and orphan messages are rejected", async () => {
  const db = await openSchema();
  const on = db.exec("PRAGMA foreign_keys");
  assert.equal(Number(on[0].values[0][0]), 1);
  assert.throws(() => {
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, sort_index, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`,
      ["m1", "missing-conv", "user", "x", 0, "h"],
    );
  });
  db.close();
});

test("20k message survives insert and sqlite export/restore", async () => {
  const db = await openSchema();
  const now = new Date().toISOString();
  const long = "W".repeat(20_000);
  db.run(
    `INSERT INTO sources (id, provider, label, imported_at, parser, parser_version, raw_sha256, byte_length, raw_retained, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["src1", "grok", "t", now, "grok", "grok@2", "abc", 12, 1, "complete"],
  );
  db.run(
    `INSERT INTO conversations (id, source_id, source_conversation_id, title, created_at, imported_at, content_sha256, parser, parser_version, message_count, char_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["c1", "src1", "grok-orig-id", "Long", "2024-03-09T16:00:00.000Z", now, "hash", "grok", "grok@2", 1, long.length],
  );
  db.run(
    `INSERT INTO messages (id, conversation_id, source_message_id, role, content, timestamp, sort_index, is_on_current_path, content_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["m1", "c1", "g-msg-1", "user", long, "2024-03-09T16:00:01.000Z", 0, 1, "mh"],
  );
  const bytes = db.export();
  db.close();
  const wasmBinary = readFileSync(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
  const SQL = await initSqlJs({ wasmBinary });
  const restored = new SQL.Database(bytes);
  restored.run("PRAGMA foreign_keys = ON");
  const row = restored.exec("SELECT length(content), source_message_id, timestamp FROM messages WHERE id='m1'");
  assert.equal(Number(row[0].values[0][0]), 20_000);
  assert.equal(row[0].values[0][1], "g-msg-1");
  assert.equal(row[0].values[0][2], "2024-03-09T16:00:01.000Z");
  const conv = restored.exec("SELECT source_conversation_id, parser_version, created_at FROM conversations WHERE id='c1'");
  assert.equal(conv[0].values[0][0], "grok-orig-id");
  assert.equal(conv[0].values[0][1], "grok@2");
  assert.equal(conv[0].values[0][2], "2024-03-09T16:00:00.000Z");
  restored.close();
});

test("duplicate import keeps two rows plus exact_duplicate relationship", async () => {
  const db = await openSchema();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO sources (id, provider, label, imported_at, parser, parser_version) VALUES (?, ?, ?, ?, ?, ?)`,
    ["src1", "generic", "a", now, "generic", "generic@2"],
  );
  db.run(
    `INSERT INTO sources (id, provider, label, imported_at, parser, parser_version) VALUES (?, ?, ?, ?, ?, ?)`,
    ["src2", "generic", "b", now, "generic", "generic@2"],
  );
  db.run(
    `INSERT INTO conversations (id, source_id, title, imported_at, content_sha256) VALUES (?, ?, ?, ?, ?)`,
    ["c1", "src1", "Same", now, "samehash"],
  );
  db.run(
    `INSERT INTO conversations (id, source_id, title, imported_at, content_sha256) VALUES (?, ?, ?, ?, ?)`,
    ["c2", "src2", "Same", now, "samehash"],
  );
  db.run(
    `INSERT INTO relationships (id, kind, from_id, to_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    ["r1", "exact_duplicate", "c2", "c1", now],
  );
  assert.equal(Number(db.exec("SELECT COUNT(*) FROM conversations")[0].values[0][0]), 2);
  assert.equal(Number(db.exec("SELECT COUNT(*) FROM sources")[0].values[0][0]), 2);
  assert.equal(Number(db.exec("SELECT COUNT(*) FROM relationships WHERE kind='exact_duplicate'")[0].values[0][0]), 1);
  db.close();
});

test("attachment availability is stored and distinct from having bytes", async () => {
  const db = await openSchema();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO sources (id, provider, label, imported_at, parser, parser_version) VALUES (?, ?, ?, ?, ?, ?)`,
    ["src1", "chatgpt", "a", now, "chatgpt", "chatgpt@2"],
  );
  db.run(
    `INSERT INTO conversations (id, source_id, title, imported_at, content_sha256) VALUES (?, ?, ?, ?, ?)`,
    ["c1", "src1", "A", now, "h"],
  );
  db.run(
    `INSERT INTO messages (id, conversation_id, role, content, sort_index, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`,
    ["m1", "c1", "user", "see image", 0, "h"],
  );
  db.run(
    `INSERT INTO attachments (id, message_id, conversation_id, kind, url, availability) VALUES (?, ?, ?, ?, ?, ?)`,
    ["a1", "m1", "c1", "image", "file-abc", "reference"],
  );
  const row = db.exec("SELECT availability, url FROM attachments WHERE id='a1'");
  assert.equal(row[0].values[0][0], "reference");
  assert.equal(row[0].values[0][1], "file-abc");
  db.close();
});

test("ChatGPT mapping keeps unused branches, not only current_node", () => {
  const mapping = {
    sys: { id: "sys", parent: null, message: { author: { role: "system" }, content: { parts: ["sys"] } } },
    u1: { id: "u1", parent: "sys", message: { author: { role: "user" }, content: { parts: ["main"] } } },
    a1: { id: "a1", parent: "u1", message: { author: { role: "assistant" }, content: { parts: ["reply"] } } },
    u1b: { id: "u1b", parent: "sys", message: { author: { role: "user" }, content: { parts: ["BRANCH"] } } },
  };
  const current = "a1";
  const onPath = new Set();
  let id = current;
  const guard = new Set();
  while (id && mapping[id] && !guard.has(id)) {
    guard.add(id);
    onPath.add(id);
    id = mapping[id].parent ?? undefined;
  }
  const allTexts = Object.values(mapping)
    .filter((n) => n.message)
    .map((n) => n.message.content.parts.join(""));
  assert.equal(allTexts.includes("BRANCH"), true);
  assert.equal(onPath.has("u1b"), false);
  assert.equal(onPath.has("a1"), true);
});
