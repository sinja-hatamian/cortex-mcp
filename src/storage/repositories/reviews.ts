import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ClaimEvaluation,
  Review,
  ReviewFinding,
  ReviewInput,
  ReviewTarget,
} from '../../core/models.js';
import { inTransaction } from '../transaction.js';

type ReviewRow = {
  id: string;
  project_id: string;
  created_at: string;
  policy_version: string;
  claim_evaluations: string;
} & (
  | Pick<
      Extract<ReviewTarget, { target_type: 'claim' }>,
      'target_type' | 'claim_id' | 'status'
    >
  | Pick<
      Extract<ReviewTarget, { target_type: 'decision' }>,
      'target_type' | 'decision' | 'status'
    >
);

type FindingRow = Omit<ReviewFinding, 'record_ids'> & { record_ids: string };

export function reviewRepository(db: DatabaseSync) {
  const repository = {
    save(projectId: string, input: ReviewInput): Review {
      const id = randomUUID();
      const now = new Date().toISOString();
      const claimIds =
        input.target_type === 'claim' ? [input.claim_id] : input.claim_ids;
      const evaluated = new Set<string>();
      const claimEvaluations = input.claim_evaluations.map(
        ({ claim_id, state, assurance, criteria_satisfied_as_reported }) => {
          if (!claimIds.includes(claim_id) || evaluated.has(claim_id)) {
            throw new Error(
              'Each claim evaluation must reference a distinct review claim',
            );
          }
          evaluated.add(claim_id);
          return { claim_id, state, assurance, criteria_satisfied_as_reported };
        },
      );

      return inTransaction(db, () => {
        db.prepare(
          `
          INSERT INTO reviews
            (project_id, id, target_type, claim_id, decision, status, policy_version, claim_evaluations, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          projectId,
          id,
          input.target_type,
          input.target_type === 'claim' ? input.claim_id : null,
          input.target_type === 'decision' ? input.decision : null,
          input.status,
          input.policy_version,
          JSON.stringify(claimEvaluations),
          now,
        );

        if (input.target_type === 'decision') {
          const insertTarget = db.prepare(`
            INSERT INTO review_targets (project_id, review_id, position, claim_id, assumption_id)
            VALUES (?, ?, ?, ?, ?)
          `);
          input.claim_ids.forEach((claimId, position) =>
            insertTarget.run(projectId, id, position, claimId, null),
          );
          input.assumption_ids.forEach((assumptionId, position) =>
            insertTarget.run(
              projectId,
              id,
              input.claim_ids.length + position,
              null,
              assumptionId,
            ),
          );
        }

        const findRecord = db.prepare(`
          SELECT 1 FROM claims WHERE project_id = $projectId AND id = $recordId
          UNION ALL SELECT 1 FROM claim_criteria WHERE project_id = $projectId AND id = $recordId
          UNION ALL SELECT 1 FROM evidence WHERE project_id = $projectId AND id = $recordId
          UNION ALL SELECT 1 FROM assumptions WHERE project_id = $projectId AND id = $recordId
        `);
        const insertFinding = db.prepare(`
          INSERT INTO review_findings (project_id, review_id, position, rule_id, severity, record_ids, message)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        input.findings.forEach((finding, position) => {
          for (const recordId of finding.record_ids) {
            if (!findRecord.get({ projectId, recordId })) {
              throw new Error('Finding record not found in project');
            }
          }
          insertFinding.run(
            projectId,
            id,
            position,
            finding.rule_id,
            finding.severity,
            JSON.stringify(finding.record_ids),
            finding.message,
          );
        });

        const saved = repository.find(projectId, id);
        if (!saved) throw new Error('Saved review could not be read');
        return saved;
      });
    },

    find(projectId: string, reviewId: string): Review | undefined {
      const row = db
        .prepare('SELECT * FROM reviews WHERE project_id = ? AND id = ?')
        .get(projectId, reviewId) as ReviewRow | undefined;
      if (!row) return undefined;

      const findings = db
        .prepare(
          `
        SELECT rule_id, severity, record_ids, message FROM review_findings
        WHERE project_id = ? AND review_id = ? ORDER BY position
      `,
        )
        .all(projectId, reviewId) as FindingRow[];
      const snapshot = {
        id: row.id,
        project_id: row.project_id,
        created_at: row.created_at,
        policy_version: row.policy_version,
        claim_evaluations: JSON.parse(
          row.claim_evaluations,
        ) as ClaimEvaluation[],
        findings: findings.map((finding): ReviewFinding => ({
          ...finding,
          record_ids: JSON.parse(finding.record_ids) as string[],
        })),
      };
      if (row.target_type === 'claim') {
        return {
          ...snapshot,
          target_type: 'claim',
          claim_id: row.claim_id,
          status: row.status,
        };
      }

      const targets = db
        .prepare(
          `
        SELECT claim_id, assumption_id FROM review_targets
        WHERE project_id = ? AND review_id = ? ORDER BY position
      `,
        )
        .all(projectId, reviewId) as {
        claim_id: string | null;
        assumption_id: string | null;
      }[];
      return {
        ...snapshot,
        target_type: 'decision',
        decision: row.decision,
        status: row.status,
        claim_ids: targets.flatMap(({ claim_id }) =>
          claim_id === null ? [] : [claim_id],
        ),
        assumption_ids: targets.flatMap(({ assumption_id }) =>
          assumption_id === null ? [] : [assumption_id],
        ),
      };
    },
  };
  return repository;
}
