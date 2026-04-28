import type { DB } from './db/index.js';
import type { AuditLogRow } from './types.js';

export type AuditEntity = AuditLogRow['entity'];
export type AuditAction = AuditLogRow['action'];

export interface AuditEntry {
  user_id: number;
  entity: AuditEntity;
  entity_id: number;
  action: AuditAction;
  diff?: unknown;
}

/**
 * Append an `audit_log` row. Always call inside the same transaction as the
 * mutation it's describing — attribution must land atomically with the
 * change itself, never "best effort."
 */
export function writeAudit(db: DB, entry: AuditEntry): void {
  db.prepare(
    'INSERT INTO audit_log (user_id, entity, entity_id, action, diff_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    entry.user_id,
    entry.entity,
    entry.entity_id,
    entry.action,
    entry.diff === undefined ? null : JSON.stringify(entry.diff),
    new Date().toISOString(),
  );
}
