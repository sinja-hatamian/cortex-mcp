import type { DatabaseSync } from 'node:sqlite';
import { MAX_CONTEXT_LIMIT } from '../../core/context.js';
import type {
  ContextCollection,
  ContextCriterion,
  ProjectContext,
} from '../../core/context.js';
import { MAX_CLAIM_CRITERIA } from '../../core/models.js';
import { inTransaction } from '../transaction.js';
import { testRunRepository } from './test-runs.js';

type ClaimRow = Omit<NonNullable<ProjectContext['claims']>[number], 'criteria'>;
type CriterionRow = Omit<ContextCriterion, 'required'> & { required: number };

export function contextRepository(db: DatabaseSync) {
  const testRuns = testRunRepository(db);
  return {
    get(
      projectId: string,
      include: readonly ContextCollection[],
      limit: number,
    ): ProjectContext {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONTEXT_LIMIT) {
        throw new RangeError(
          `Context limit must be an integer from 1 to ${MAX_CONTEXT_LIMIT}`,
        );
      }

      return inTransaction(
        db,
        () => {
          const result: ProjectContext = { project_id: projectId };
          if (include.includes('claims')) {
            const claims = db
              .prepare(
                `
            SELECT id AS claim_id, statement, created_at, updated_at FROM claims
            WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
          `,
              )
              .all(projectId, limit) as ClaimRow[];
            const criteria = db.prepare(`
            SELECT id AS criterion_id, key, required FROM claim_criteria
            WHERE project_id = ? AND claim_id = ? ORDER BY position LIMIT ?
          `);
            result.claims = claims.map((claim) => ({
              ...claim,
              criteria: (
                criteria.all(
                  projectId,
                  claim.claim_id,
                  MAX_CLAIM_CRITERIA,
                ) as CriterionRow[]
              ).map((row) => ({ ...row, required: row.required === 1 })),
            }));
          }
          if (include.includes('assumptions')) {
            result.assumptions = db
              .prepare(
                `
            SELECT id AS assumption_id, statement, context, confidence, status, created_at, updated_at
            FROM assumptions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
          `,
              )
              .all(projectId, limit) as ProjectContext['assumptions'];
          }
          if (include.includes('assumption_events')) {
            result.assumption_events = db
              .prepare(
                `
            SELECT id AS event_id, assumption_id, position, previous_status, status, reason, created_at
            FROM assumption_events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
          `,
              )
              .all(projectId, limit) as ProjectContext['assumption_events'];
          }
          if (include.includes('evidence')) {
            result.evidence = db
              .prepare(
                `
            SELECT id AS evidence_id, claim_id, criterion_id, origin, source_type, source_ref, observed_at,
              relation, content_summary, artifact_digest, collector, integrity_status, created_at,
              'unverified_origin' AS assurance
            FROM evidence WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
          `,
              )
              .all(projectId, limit) as ProjectContext['evidence'];
          }
          if (include.includes('reviews')) {
            result.reviews = db
              .prepare(
                `
            SELECT id AS review_id, target_type, claim_id, decision, status, policy_version, created_at
            FROM reviews WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
          `,
              )
              .all(projectId, limit) as ProjectContext['reviews'];
          }
          if (include.includes('test_runs')) {
            result.test_runs = testRuns.list(projectId, limit);
          }
          return result;
        },
        'read',
      );
    },
  };
}
