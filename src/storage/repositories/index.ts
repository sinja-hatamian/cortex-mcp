import type { DatabaseSync } from 'node:sqlite';
import type { Project, ProjectPolicy } from '../../core/models.js';
import { assumptionRepository } from './assumptions.js';
import { claimRepository, evidenceRepository } from './claims.js';
import { contextRepository } from './context.js';
import { reviewRepository } from './reviews.js';

export function createRepositories(db: DatabaseSync) {
  return {
    projects: {
      create(projectId: string, policy: ProjectPolicy = 'strict'): Project {
        const now = new Date().toISOString();
        return db
          .prepare(
            'INSERT INTO projects (project_id, policy, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *',
          )
          .get(projectId, policy, now, now) as Project;
      },

      find(projectId: string): Project | undefined {
        return db
          .prepare('SELECT * FROM projects WHERE project_id = ?')
          .get(projectId) as Project | undefined;
      },
    },
    claims: claimRepository(db),
    evidence: evidenceRepository(db),
    assumptions: assumptionRepository(db),
    reviews: reviewRepository(db),
    context: contextRepository(db),
  };
}
