import type { DatabaseSync } from 'node:sqlite';
import { inTransaction } from '../transaction.js';
import { initialSchema } from './001-initial.js';
import { testRunSchema } from './002-test-runs.js';

const migrations = [
  { version: 1, sql: initialSchema, markApplied: 'PRAGMA user_version = 1' },
  { version: 2, sql: testRunSchema, markApplied: 'PRAGMA user_version = 2' },
];

export function migrate(db: DatabaseSync): void {
  inTransaction(db, () => {
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (
      typeof version !== 'number' ||
      version < 0 ||
      version > migrations[migrations.length - 1].version
    ) {
      throw new Error('Unsupported Cortex database schema version');
    }

    for (const migration of migrations) {
      if (migration.version <= version) continue;
      db.exec(migration.sql);
      db.exec(migration.markApplied);
    }
  });
}
