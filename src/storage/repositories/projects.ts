import type { DatabaseSync } from 'node:sqlite';

export function ensureProject(
  db: DatabaseSync,
  projectId: string,
  now: string,
): void {
  db.prepare(
    `
    INSERT INTO projects (project_id, created_at, updated_at)
    VALUES (?, ?, ?) ON CONFLICT (project_id) DO NOTHING
  `,
  ).run(projectId, now, now);
}
