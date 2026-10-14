import { newId } from "./ids";
import { foreignKeysEnabled, openSqlite } from "./sqlite";
import type { IntegrityIssue, IntegrityReport } from "./types";

export async function validateArchive(): Promise<IntegrityReport> {
  const db = await openSqlite();
  const issues: IntegrityIssue[] = [];
  const n = (sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0);

  const foreignKeysOn = foreignKeysEnabled(db);
  if (!foreignKeysOn) issues.push({ code: "fk_off", detail: "PRAGMA foreign_keys is not ON." });

  try {
    const fk = db.exec("PRAGMA foreign_key_check");
    if (fk[0]?.values?.length) {
      issues.push({
        code: "fk_violations",
        detail: `${fk[0].values.length} foreign-key violations.`,
      });
    }
  } catch (err) {
    issues.push({ code: "fk_check_failed", detail: err instanceof Error ? err.message : "foreign_key_check failed" });
  }

  const conversations = n("SELECT COUNT(*) FROM conversations");
  const messages = n("SELECT COUNT(*) FROM messages");
  const attachments = n("SELECT COUNT(*) FROM attachments");
  const sources = n("SELECT COUNT(*) FROM sources");

  const orphanMessages = n(
    "SELECT COUNT(*) FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id WHERE c.id IS NULL",
  );
  const orphanAttachments = n(
    "SELECT COUNT(*) FROM attachments a LEFT JOIN conversations c ON c.id = a.conversation_id WHERE a.conversation_id IS NOT NULL AND c.id IS NULL",
  );
  const orphanSources = n(
    "SELECT COUNT(*) FROM conversations c LEFT JOIN sources s ON s.id = c.source_id WHERE s.id IS NULL",
  );
  const dupConv = n("SELECT COUNT(*) FROM (SELECT id FROM conversations GROUP BY id HAVING COUNT(*) > 1)");
  const dupMsg = n("SELECT COUNT(*) FROM (SELECT id FROM messages GROUP BY id HAVING COUNT(*) > 1)");
  const missingHash = n("SELECT COUNT(*) FROM conversations WHERE content_sha256 IS NULL OR content_sha256 = ''");
  const missingTitle = n("SELECT COUNT(*) FROM conversations WHERE title IS NULL OR title = ''");

  if (orphanMessages) issues.push({ code: "orphan_messages", detail: `${orphanMessages} messages with no conversation.` });
  if (orphanAttachments) issues.push({ code: "orphan_attachments", detail: `${orphanAttachments} attachments with no conversation.` });
  if (orphanSources) issues.push({ code: "orphan_sources", detail: `${orphanSources} conversations with no source.` });
  if (dupConv) issues.push({ code: "dup_conversation_ids", detail: "Duplicate conversation ids." });
  if (dupMsg) issues.push({ code: "dup_message_ids", detail: "Duplicate message ids." });
  if (missingHash) issues.push({ code: "missing_hash", detail: `${missingHash} conversations missing content_sha256.` });
  if (missingTitle) issues.push({ code: "missing_title", detail: `${missingTitle} conversations missing title.` });

  return {
    ok: issues.length === 0,
    foreignKeysOn,
    issues,
    conversations,
    messages,
    attachments,
    sources,
    orphans: orphanMessages + orphanAttachments + orphanSources,
  };
}

export function newIntegrityId(): string {
  return newId("val");
}
