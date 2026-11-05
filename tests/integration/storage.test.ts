import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import {
  contextCollections,
  MAX_CONTEXT_LIMIT,
} from '../../src/core/context.js';
import type { EvidenceInput, ReviewInput } from '../../src/core/models.js';
import { openDatabase, resolveDataDirectory } from '../../src/storage/db.js';
import { migrate } from '../../src/storage/migrations/index.js';
import { createRepositories } from '../../src/storage/repositories/index.js';

const tempRoots: string[] = [];
const project = 'api';
const otherProject = 'other-api';
const criterion = {
  key: 'route-test',
  description: 'Run protected route tests',
  required: true,
};

function storageEnv(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'cortex-storage-'));
  tempRoots.push(root);
  return { CORTEX_DATA_DIR: join(root, 'data') };
}

function reportedEvidence(claimId: string): EvidenceInput {
  return {
    claim_id: claimId,
    observed_at: '2026-11-05T03:30:00+03:30',
    origin: 'agent_reported',
    source_type: 'test',
    relation: 'supports',
    content_summary: 'Route tests passed',
  };
}

function claimReview(claimId: string): ReviewInput {
  return {
    target_type: 'claim',
    claim_id: claimId,
    status: 'unverified',
    policy_version: 'strict-1',
    claim_evaluations: [
      {
        claim_id: claimId,
        state: 'unverified',
        criteria_satisfied_as_reported: false,
      },
    ],
    findings: [
      {
        rule_id: 'MISSING_REQUIRED_EVIDENCE',
        severity: 'warning',
        record_ids: [claimId],
        message: 'The required criterion has no evidence.',
      },
    ],
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test('resolves OS data directories and gives new storage private POSIX permissions', () => {
  expect(resolveDataDirectory({}, 'darwin', '/home/example')).toBe(
    '/home/example/Library/Application Support/Cortex MCP',
  );
  expect(resolveDataDirectory({}, 'linux', '/home/example')).toBe(
    '/home/example/.local/share/cortex-mcp',
  );
  expect(
    resolveDataDirectory(
      { XDG_DATA_HOME: '/var/data' },
      'linux',
      '/home/example',
    ),
  ).toBe('/var/data/cortex-mcp');
  expect(
    resolveDataDirectory(
      { XDG_DATA_HOME: 'relative' },
      'linux',
      '/home/example',
    ),
  ).toBe('/home/example/.local/share/cortex-mcp');
  expect(
    resolveDataDirectory(
      { LOCALAPPDATA: 'C:/Local' },
      'win32',
      'C:/Users/example',
    ),
  ).toBe('C:\\Local\\Cortex MCP');
  expect(resolveDataDirectory({}, 'win32', 'C:/Users/example')).toBe(
    'C:\\Users\\example\\AppData\\Local\\Cortex MCP',
  );
  expect(
    resolveDataDirectory(
      { CORTEX_DATA_DIR: '/chosen', XDG_DATA_HOME: '/var/data' },
      'linux',
    ),
  ).toBe('/chosen');
  expect(() => resolveDataDirectory({ CORTEX_DATA_DIR: 'relative' })).toThrow(
    'absolute',
  );

  const env = storageEnv();
  using db = openDatabase(env);
  const dir = resolveDataDirectory(env);
  const dbFile = join(dir, 'cortex.sqlite3');
  expect(statSync(dbFile).isFile()).toBe(true);
  if (process.platform !== 'win32') {
    expect(statSync(dir).mode & 0o077).toBe(0);
    expect(statSync(dbFile).mode & 0o077).toBe(0);
  }
  expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
});

test('migrations produce the same schema, rerun safely, and reject a newer version', () => {
  using first = openDatabase(storageEnv());
  using second = openDatabase(storageEnv());
  const schema = (db: DatabaseSync) =>
    db.prepare('SELECT name, sql FROM sqlite_schema ORDER BY name').all();

  expect(first.prepare('PRAGMA user_version').get()).toEqual({
    user_version: 1,
  });
  const initial = schema(first);
  expect(initial).toEqual(schema(second));
  migrate(first);
  expect(schema(first)).toEqual(initial);

  first.exec('PRAGMA user_version = 2');
  expect(() => migrate(first)).toThrow(
    'Unsupported Cortex database schema version',
  );
  expect(first.prepare('PRAGMA user_version').get()).toEqual({
    user_version: 2,
  });
  expect(schema(first)).toEqual(initial);
});

test('a failed migration rolls back its earlier tables and leaves the version alone', () => {
  using db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE assumptions (id TEXT)');
  expect(() => migrate(db)).toThrow();
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
  expect(db.prepare('SELECT name FROM sqlite_schema').all()).toEqual([
    { name: 'assumptions' },
  ]);
  expect(db.isTransaction).toBe(false);
});

test('enforces project scope and criterion ownership on reads and writes', () => {
  using db = openDatabase(storageEnv());
  const repos = createRepositories(db);
  repos.projects.create(project);
  repos.projects.create(otherProject);
  const first = repos.claims.create(project, 'First claim', [criterion]);
  const second = repos.claims.create(project, 'Second claim', [criterion]);
  const foreign = repos.claims.create(otherProject, 'Foreign claim', [
    criterion,
  ]);
  const assumption = repos.assumptions.create(project, {
    statement: 'Assumption in API',
  });
  const review = repos.reviews.save(project, claimReview(first.id));

  const evidence = reportedEvidence(first.id);
  repos.evidence.add(project, {
    ...evidence,
    criterion_id: first.criteria[0].id,
  });
  expect(repos.claims.find(otherProject, first.id)).toBeUndefined();
  expect(repos.evidence.listForClaim(otherProject, first.id)).toEqual([]);
  expect(repos.assumptions.find(otherProject, assumption.id)).toBeUndefined();
  expect(repos.assumptions.listEvents(otherProject, assumption.id)).toEqual([]);
  expect(repos.reviews.find(otherProject, review.id)).toBeUndefined();

  expect(() =>
    repos.claims.create('missing', 'Unknown project', [criterion]),
  ).toThrow(/foreign key/i);
  expect(() => repos.evidence.add(otherProject, evidence)).toThrow(
    /foreign key/i,
  );
  expect(() =>
    repos.evidence.add(project, {
      ...evidence,
      criterion_id: second.criteria[0].id,
    }),
  ).toThrow(/foreign key/i);
  expect(() =>
    repos.evidence.add(project, {
      ...evidence,
      criterion_id: foreign.criteria[0].id,
    }),
  ).toThrow(/foreign key/i);
  expect(() =>
    repos.assumptions.updateStatus(
      otherProject,
      assumption.id,
      'refuted',
      'Reason',
    ),
  ).toThrow('Assumption not found in project');
  expect(() => repos.reviews.save(otherProject, claimReview(first.id))).toThrow(
    /foreign key/i,
  );
  expect(() =>
    repos.reviews.save(otherProject, {
      target_type: 'decision',
      decision: 'Deploy',
      status: 'warning',
      policy_version: 'strict-1',
      claim_evaluations: [],
      findings: [],
      claim_ids: [foreign.id],
      assumption_ids: [assumption.id],
    }),
  ).toThrow(/foreign key/i);

  expect(repos.evidence.listForClaim(project, first.id)).toHaveLength(1);
  expect(repos.assumptions.find(project, assumption.id)?.status).toBe(
    'unverified',
  );
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('rolls back incomplete claims, assumption transitions, and review snapshots', () => {
  using db = openDatabase(storageEnv());
  const repos = createRepositories(db);
  repos.projects.create(project);
  repos.projects.create(otherProject);

  expect(() => repos.claims.create(project, 'No criteria', [])).toThrow(
    RangeError,
  );
  expect(() =>
    repos.claims.create(project, 'Duplicate criterion', [criterion, criterion]),
  ).toThrow(/unique constraint/i);
  expect(() =>
    repos.claims.create(
      'new-project',
      'Duplicate criterion',
      [criterion, criterion],
      {
        createProjectIfMissing: true,
      },
    ),
  ).toThrow(/unique constraint/i);
  expect(repos.projects.find('new-project')).toBeUndefined();
  expect(db.prepare('SELECT count(*) AS count FROM claims').get()).toEqual({
    count: 0,
  });
  expect(
    db.prepare('SELECT count(*) AS count FROM claim_criteria').get(),
  ).toEqual({ count: 0 });

  const claim = repos.claims.create(project, 'Protected routes', [criterion]);
  const foreign = repos.claims.create(otherProject, 'Foreign claim', [
    criterion,
  ]);
  const assumption = repos.assumptions.create(project, {
    statement: 'Middleware is active',
  });

  expect(() =>
    repos.assumptions.updateStatus(project, assumption.id, 'refuted', ''),
  ).toThrow(/check constraint/i);
  expect(repos.assumptions.find(project, assumption.id)).toEqual(assumption);
  expect(repos.assumptions.listEvents(project, assumption.id)).toEqual([]);

  const finding = claimReview(claim.id).findings[0];
  expect(() =>
    repos.reviews.save(project, {
      target_type: 'decision',
      decision: 'Deploy',
      status: 'warning',
      policy_version: 'strict-1',
      claim_evaluations: [],
      findings: [finding, { ...finding, record_ids: [foreign.id] }],
      claim_ids: [claim.id],
      assumption_ids: [assumption.id],
    }),
  ).toThrow('Finding record not found in project');
  expect(db.prepare('SELECT count(*) AS count FROM reviews').get()).toEqual({
    count: 0,
  });
  expect(
    db.prepare('SELECT count(*) AS count FROM review_targets').get(),
  ).toEqual({ count: 0 });
  expect(
    db.prepare('SELECT count(*) AS count FROM review_findings').get(),
  ).toEqual({ count: 0 });
});

test('review snapshot reads and persistence share a transaction that excludes competing writes', () => {
  const env = storageEnv();
  using db = openDatabase(env);
  using writer = new DatabaseSync(
    join(resolveDataDirectory(env), 'cortex.sqlite3'),
  );
  const repos = createRepositories(db);
  const competing = createRepositories(writer);
  repos.projects.create(project);
  const claim = repos.claims.create(project, 'Protected routes', [criterion]);

  const review = repos.reviews.saveFromSnapshot(project, () => {
    expect(db.isTransaction).toBe(true);
    expect(() =>
      competing.evidence.add(project, reportedEvidence(claim.id)),
    ).toThrow(/locked/i);
    expect(repos.evidence.listForClaim(project, claim.id)).toEqual([]);
    return claimReview(claim.id);
  });

  expect(db.isTransaction).toBe(false);
  competing.evidence.add(project, reportedEvidence(claim.id));
  expect(repos.reviews.find(project, review.id)).toEqual(review);
});

test('context limits each collection, orders timestamp ties by ID, and excludes other projects', () => {
  using db = openDatabase(storageEnv());
  const repos = createRepositories(db);
  repos.projects.create(project);
  repos.projects.create(otherProject);

  function seed(projectId: string) {
    const claim = repos.claims.create(projectId, 'Protected routes', [
      criterion,
    ]);
    const evidence = repos.evidence.add(projectId, reportedEvidence(claim.id));
    const assumption = repos.assumptions.create(projectId, {
      statement: 'Middleware is active',
    });
    repos.assumptions.updateStatus(
      projectId,
      assumption.id,
      'supported',
      'Route inspection',
    );
    const [event] = repos.assumptions.listEvents(projectId, assumption.id);
    const review = repos.reviews.save(projectId, claimReview(claim.id));
    return {
      claim_id: claim.id,
      evidence_id: evidence.id,
      assumption_id: assumption.id,
      event_id: event.id,
      review_id: review.id,
    };
  }

  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-11-05T00:00:00.000Z'));
    const tied = Array.from({ length: MAX_CONTEXT_LIMIT + 1 }, () =>
      seed(project),
    );
    vi.setSystemTime(new Date('2026-11-05T00:00:01.000Z'));
    const newest = seed(project);
    seed(otherProject);

    function expected(key: keyof typeof newest) {
      return [
        newest[key],
        ...tied
          .map((record) => record[key])
          .sort()
          .reverse()
          .slice(0, MAX_CONTEXT_LIMIT - 1),
      ];
    }

    const context = repos.context.get(
      project,
      contextCollections,
      MAX_CONTEXT_LIMIT,
    );
    expect(context.claims?.map(({ claim_id }) => claim_id)).toEqual(
      expected('claim_id'),
    );
    expect(
      context.assumptions?.map(({ assumption_id }) => assumption_id),
    ).toEqual(expected('assumption_id'));
    expect(context.assumption_events?.map(({ event_id }) => event_id)).toEqual(
      expected('event_id'),
    );
    expect(context.evidence?.map(({ evidence_id }) => evidence_id)).toEqual(
      expected('evidence_id'),
    );
    expect(context.reviews?.map(({ review_id }) => review_id)).toEqual(
      expected('review_id'),
    );
    expect(repos.context.get(project, ['reviews'], 1)).toEqual({
      project_id: project,
      reviews: [
        {
          review_id: newest.review_id,
          target_type: 'claim',
          status: 'unverified',
          claim_id: newest.claim_id,
          decision: null,
          policy_version: 'strict-1',
          created_at: '2026-11-05T00:00:01.000Z',
        },
      ],
    });
    expect(() => repos.context.get(project, contextCollections, -1)).toThrow(
      RangeError,
    );
  } finally {
    vi.useRealTimers();
  }
});

test('binds evidence text, normalizes provenance fields, and validates bounds', () => {
  using db = openDatabase(storageEnv());
  const repos = createRepositories(db);
  expect(repos.projects.create(project).policy).toBe('strict');
  const claim = repos.claims.create(project, 'Protected routes', [criterion]);
  const evidence = reportedEvidence(claim.id);
  const text = "'; DROP TABLE claims; --";
  const saved = repos.evidence.add(project, {
    ...evidence,
    content_summary: text,
  });
  expect(saved).toMatchObject({
    content_summary: text,
    observed_at: '2026-11-05T00:00:00.000Z',
    origin: 'agent_reported',
    criterion_id: null,
    integrity_status: 'unverified',
  });
  const withDigest = repos.evidence.add(project, {
    ...evidence,
    origin: 'tool_output_recorded',
    artifact_digest: 'AB'.repeat(32),
  });
  expect(withDigest).toMatchObject({
    origin: 'tool_output_recorded',
    artifact_digest: 'ab'.repeat(32),
    integrity_status: 'digest_recorded',
  });
  expect(() =>
    repos.evidence.add(project, {
      ...evidence,
      artifact_digest: 'xz'.repeat(32),
    }),
  ).toThrow(/check constraint/i);
  expect(() =>
    repos.evidence.add(project, { ...evidence, observed_at: '2026-02-31' }),
  ).toThrow();
  expect(() =>
    repos.evidence.add(project, {
      ...evidence,
      content_summary: 'x'.repeat(2001),
    }),
  ).toThrow(/check constraint/i);
  expect(repos.evidence.listForClaim(project, claim.id)).toHaveLength(2);
});

test('reopens all records in another process and preserves the original review snapshot', () => {
  const env = storageEnv();
  const saved = (() => {
    using db = openDatabase(env);
    const repos = createRepositories(db);
    const p = repos.projects.create(project, 'provisional');
    const claim = repos.claims.create(project, 'Protected routes', [
      criterion,
      { key: 'negative-test', description: 'Assert denial', required: false },
    ]);
    const assumption = repos.assumptions.create(project, {
      statement: 'Middleware is active',
    });
    const report = claimReview(claim.id);
    const review = repos.reviews.save(project, {
      ...report,
      target_type: 'decision',
      decision: 'Deploy authentication changes',
      status: 'warning',
      claim_ids: [claim.id],
      assumption_ids: [assumption.id],
      findings: [
        ...report.findings,
        {
          rule_id: 'UNRESOLVED_ASSUMPTION',
          severity: 'warning',
          record_ids: [assumption.id],
          message: 'Middleware is an unresolved assumption.',
        },
      ],
    });
    repos.evidence.add(project, {
      ...reportedEvidence(claim.id),
      criterion_id: claim.criteria[0].id,
    });
    repos.assumptions.updateStatus(
      project,
      assumption.id,
      'supported',
      'First inspection',
    );
    repos.assumptions.updateStatus(
      project,
      assumption.id,
      'refuted',
      'Second inspection',
    );
    expect(repos.reviews.find(project, review.id)).toEqual(review);
    return { p, claim, assumption, review };
  })();

  const dbModule = new URL('../../dist/storage/db.js', import.meta.url).href;
  const repoModule = new URL(
    '../../dist/storage/repositories/index.js',
    import.meta.url,
  ).href;
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import { openDatabase } from ${JSON.stringify(dbModule)};
    import { createRepositories } from ${JSON.stringify(repoModule)};
    const [projectId, claimId, assumptionId, reviewId] = process.argv.slice(1);
    const db = openDatabase();
    const repos = createRepositories(db);
    process.stdout.write(JSON.stringify({
      project: repos.projects.find(projectId),
      claim: repos.claims.find(projectId, claimId),
      assumption: repos.assumptions.find(projectId, assumptionId),
      evidence: repos.evidence.listForClaim(projectId, claimId),
      events: repos.assumptions.listEvents(projectId, assumptionId),
      review: repos.reviews.find(projectId, reviewId),
    }));
    db.close();
  `,
      project,
      saved.claim.id,
      saved.assumption.id,
      saved.review.id,
    ],
    {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );

  expect(JSON.parse(output)).toMatchObject({
    project: saved.p,
    claim: saved.claim,
    assumption: { id: saved.assumption.id, status: 'refuted' },
    evidence: [
      { criterion_id: saved.claim.criteria[0].id, origin: 'agent_reported' },
    ],
    events: [
      {
        previous_status: 'unverified',
        status: 'supported',
        reason: 'First inspection',
      },
      {
        previous_status: 'supported',
        status: 'refuted',
        reason: 'Second inspection',
      },
    ],
    review: saved.review,
  });
});
