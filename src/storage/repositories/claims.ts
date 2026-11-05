import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { iso } from 'zod/v4';
import { MAX_CLAIM_CRITERIA } from '../../core/models.js';
import type {
  Claim,
  ClaimWithCriteria,
  Criterion,
  CriterionInput,
  Evidence,
  EvidenceInput,
} from '../../core/models.js';
import { inTransaction } from '../transaction.js';
import { ensureProject } from './projects.js';

type CriterionRow = Omit<Criterion, 'required'> & { required: number };

const observedAt = iso.datetime({ offset: true });

export function claimRepository(db: DatabaseSync) {
  const find = (
    projectId: string,
    claimId: string,
  ): ClaimWithCriteria | undefined => {
    const claim = db
      .prepare('SELECT * FROM claims WHERE project_id = ? AND id = ?')
      .get(projectId, claimId) as Claim | undefined;
    if (!claim) return undefined;

    const rows = db
      .prepare(
        `
        SELECT project_id, claim_id, id, key, description, required, created_at, updated_at
        FROM claim_criteria WHERE project_id = ? AND claim_id = ? ORDER BY position
      `,
      )
      .all(projectId, claimId) as CriterionRow[];
    const criteria = rows.map((row) => ({
      ...row,
      required: row.required === 1,
    }));
    return { ...claim, criteria };
  };

  return {
    find,
    create(
      projectId: string,
      statement: string,
      criteria: readonly CriterionInput[],
      { createProjectIfMissing = false } = {},
    ): ClaimWithCriteria {
      if (criteria.length < 1 || criteria.length > MAX_CLAIM_CRITERIA) {
        throw new RangeError(
          `A claim must have 1 to ${MAX_CLAIM_CRITERIA} criteria`,
        );
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      return inTransaction(db, () => {
        if (createProjectIfMissing) ensureProject(db, projectId, now);
        db.prepare(
          'INSERT INTO claims (project_id, id, statement, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run(projectId, id, statement, now, now);

        const insertCriterion = db.prepare(`
          INSERT INTO claim_criteria
            (project_id, claim_id, id, key, description, required, created_at, updated_at, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const savedCriteria = criteria.map((criterion, position): Criterion => {
          const criterionId = randomUUID();
          insertCriterion.run(
            projectId,
            id,
            criterionId,
            criterion.key,
            criterion.description,
            Number(criterion.required),
            now,
            now,
            position,
          );
          return {
            key: criterion.key,
            description: criterion.description,
            required: criterion.required,
            project_id: projectId,
            claim_id: id,
            id: criterionId,
            created_at: now,
            updated_at: now,
          };
        });

        return {
          id,
          project_id: projectId,
          statement,
          created_at: now,
          updated_at: now,
          criteria: savedCriteria,
        };
      });
    },
  };
}

export function evidenceRepository(db: DatabaseSync) {
  return {
    add(projectId: string, input: EvidenceInput): Evidence {
      const observed = new Date(
        observedAt.parse(input.observed_at),
      ).toISOString();
      return db
        .prepare(
          `
        INSERT INTO evidence
          (project_id, claim_id, id, criterion_id, origin, source_type, source_ref,
            observed_at, relation, content_summary, artifact_digest, collector, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `,
        )
        .get(
          projectId,
          input.claim_id,
          randomUUID(),
          input.criterion_id ?? null,
          input.origin,
          input.source_type,
          input.source_ref ?? null,
          observed,
          input.relation,
          input.content_summary,
          input.artifact_digest?.toLowerCase() ?? null,
          input.collector ?? null,
          new Date().toISOString(),
        ) as Evidence;
    },

    listForClaim(projectId: string, claimId: string): Evidence[] {
      return db
        .prepare(
          `
        SELECT * FROM evidence
        WHERE project_id = ? AND claim_id = ?
        ORDER BY created_at, id
      `,
        )
        .all(projectId, claimId) as Evidence[];
    },
  };
}
