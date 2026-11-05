import type { DatabaseSync } from 'node:sqlite';

export function inTransaction<T>(
  db: DatabaseSync,
  operation: () => T,
  mode: 'write' | 'read' = 'write',
): T {
  db.exec(mode === 'read' ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
