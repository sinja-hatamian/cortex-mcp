import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TestRun } from '../../core/models.js';

type RunRow = Omit<TestRun, 'test_paths'> & { test_paths: string };

export function testRunRepository(db: DatabaseSync) {
  return {
    save(
      projectId: string,
      input: Omit<TestRun, 'run_id' | 'created_at'>,
    ): TestRun {
      const run = {
        ...input,
        run_id: randomUUID(),
        created_at: new Date().toISOString(),
      };
      db.prepare(
        `INSERT INTO test_runs
           (project_id, id, claim_id, criterion_id, revision, node_version, test_paths, exit_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        projectId,
        run.run_id,
        run.claim_id,
        run.criterion_id,
        run.revision,
        run.node_version,
        JSON.stringify(run.test_paths),
        run.exit_code,
        run.created_at,
      );
      return run;
    },

    list(projectId: string, limit: number): TestRun[] {
      const rows = db
        .prepare(
          `SELECT id AS run_id, claim_id, criterion_id, revision, node_version, test_paths, exit_code, created_at
           FROM test_runs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(projectId, limit) as RunRow[];
      return rows.map((row) => ({
        ...row,
        test_paths: JSON.parse(row.test_paths) as string[],
      }));
    },
  };
}
