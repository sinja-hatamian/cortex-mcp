import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Assumption,
  AssumptionEvent,
  AssumptionInput,
  AssumptionStatus,
} from '../../core/models.js';
import { inTransaction } from '../transaction.js';

export function assumptionRepository(db: DatabaseSync) {
  const find = (
    projectId: string,
    assumptionId: string,
  ): Assumption | undefined =>
    db
      .prepare('SELECT * FROM assumptions WHERE project_id = ? AND id = ?')
      .get(projectId, assumptionId) as Assumption | undefined;

  return {
    find,

    create(projectId: string, input: AssumptionInput): Assumption {
      const now = new Date().toISOString();
      return db
        .prepare(
          `
        INSERT INTO assumptions (project_id, id, statement, context, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `,
        )
        .get(
          projectId,
          randomUUID(),
          input.statement,
          input.context ?? null,
          input.confidence ?? null,
          now,
          now,
        ) as Assumption;
    },

    updateStatus(
      projectId: string,
      assumptionId: string,
      status: AssumptionStatus,
      reason: string,
    ): Assumption {
      return inTransaction(db, () => {
        const assumption = find(projectId, assumptionId);
        if (!assumption) throw new Error('Assumption not found in project');

        const now = new Date().toISOString();
        const updated = db
          .prepare(
            `
          UPDATE assumptions SET status = ?, updated_at = ? WHERE project_id = ? AND id = ?
          RETURNING *
        `,
          )
          .get(status, now, projectId, assumptionId) as Assumption;

        db.prepare(
          `
          INSERT INTO assumption_events
            (project_id, assumption_id, id, previous_status, status, reason, created_at, position)
          SELECT ?, ?, ?, ?, ?, ?, ?, coalesce(max(position), 0) + 1
          FROM assumption_events WHERE project_id = ? AND assumption_id = ?
        `,
        ).run(
          projectId,
          assumptionId,
          randomUUID(),
          assumption.status,
          status,
          reason,
          now,
          projectId,
          assumptionId,
        );

        return updated;
      });
    },

    listEvents(projectId: string, assumptionId: string): AssumptionEvent[] {
      return db
        .prepare(
          `
        SELECT project_id, assumption_id, id, previous_status, status, reason, created_at
        FROM assumption_events WHERE project_id = ? AND assumption_id = ?
        ORDER BY position
      `,
        )
        .all(projectId, assumptionId) as AssumptionEvent[];
    },
  };
}
