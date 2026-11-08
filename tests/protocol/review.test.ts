import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createClaimOutput } from '../../src/schemas/claims-evidence.js';
import { reviewOutput } from '../../src/schemas/review.js';
import { openDatabase } from '../../src/storage/db.js';
import { createRepositories } from '../../src/storage/repositories/index.js';
import { withClient } from './client.js';

const project = 'example-api';
const criterion = {
  key: 'negative-test',
  description: 'Assert denial',
  required: true,
};
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cortex-review-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function openTestDatabase() {
  return openDatabase({ CORTEX_DATA_DIR: join(root, 'data') });
}

async function createClaim(client: Client) {
  const result = await client.callTool({
    name: 'cortex_create_claim',
    arguments: {
      project_id: project,
      statement: 'Protected routes deny unauthenticated requests',
      criteria: [criterion],
    },
  });
  expect(result.isError).not.toBe(true);
  return createClaimOutput.parse(result.structuredContent);
}

async function addEvidence(
  client: Client,
  claim: Awaited<ReturnType<typeof createClaim>>,
  relation: 'supports' | 'contradicts',
) {
  const result = await client.callTool({
    name: 'cortex_add_evidence',
    arguments: {
      project_id: project,
      claim_id: claim.claim_id,
      criterion_id: claim.criteria[0].criterion_id,
      content_summary: 'Caller reports the result of the route test',
      origin: 'tool_output_recorded',
      relation,
      source_type: 'test',
      observed_at: '2026-11-05T00:00:00Z',
    },
  });
  expect(result.isError).not.toBe(true);
}

async function review(client: Client, target: Record<string, unknown>) {
  const result = await client.callTool({
    name: 'cortex_review',
    arguments: { project_id: project, ...target },
  });
  expect(result.isError).not.toBe(true);
  return reviewOutput.parse(result.structuredContent);
}

test('strict review snapshots survive restart and later evidence leaves prior findings intact', async () => {
  const { claim, before } = await withClient(root, async (client) => {
    const claim = await createClaim(client);
    const before = await review(client, {
      target_type: 'claim',
      target_id: claim.claim_id,
    });
    expect(before).toMatchObject({
      status: 'unverified',
      policy_version: 'strict-1',
      claim_evaluations: [
        {
          state: 'unverified',
          criteria_satisfied_as_reported: false,
          criterion_evaluations: [
            {
              outcome: 'missing_evidence',
              criterion_id: claim.criteria[0].criterion_id,
              key: criterion.key,
            },
          ],
        },
      ],
      findings: [
        { rule_id: 'MISSING_REQUIRED_EVIDENCE' },
        { rule_id: 'UNVERIFIED_CLAIM' },
      ],
    });
    await addEvidence(client, claim, 'supports');
    return { claim, before };
  });

  const after = await withClient(root, (client) =>
    review(client, {
      target_type: 'claim',
      target_id: claim.claim_id.toUpperCase(),
    }),
  );
  expect(after).toMatchObject({
    status: 'unverified',
    policy_version: 'strict-1',
    claim_evaluations: [
      {
        state: 'unverified',
        criteria_satisfied_as_reported: true,
        assurance: 'reported_only',
        criterion_evaluations: [
          {
            outcome: 'unverified_source',
            criterion_id: claim.criteria[0].criterion_id,
            key: criterion.key,
          },
        ],
      },
    ],
    findings: [
      { rule_id: 'REPORTED_ONLY_EVIDENCE' },
      { rule_id: 'UNVERIFIED_CLAIM' },
    ],
  });
  expect(after.review_id).not.toBe(before.review_id);

  using db = openTestDatabase();
  const repositories = createRepositories(db);
  for (const result of [before, after]) {
    const { review_id, ...snapshot } = result;
    expect(repositories.reviews.find(project, review_id)).toMatchObject({
      ...snapshot,
      claim_id: claim.claim_id,
      project_id: project,
    });
  }
});

test('legacy claims with only optional criteria can still be recovered and reviewed', async () => {
  const claim = (() => {
    using db = openTestDatabase();
    const repos = createRepositories(db);
    repos.projects.create(project);
    return repos.claims.create(project, 'Legacy claim', [
      { ...criterion, required: false },
    ]);
  })();

  await withClient(root, async (client) => {
    const context = await client.callTool({
      name: 'cortex_get_context',
      arguments: { project_id: project, include: ['claims'] },
    });
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toMatchObject({
      claims: [{ claim_id: claim.id, criteria: [{ required: false }] }],
    });
    expect(
      await review(client, { target_type: 'claim', target_id: claim.id }),
    ).toMatchObject({
      status: 'unverified',
      findings: [
        { rule_id: 'MISSING_REQUIRED_EVIDENCE' },
        { rule_id: 'UNVERIFIED_CLAIM' },
      ],
    });
  });
});

test('provisional decisions report assurance and recommend blocking for refuted assumptions or contradictions', async () => {
  const assumption = (() => {
    using db = openTestDatabase();
    const repos = createRepositories(db);
    repos.projects.create(project, 'provisional');
    const assumption = repos.assumptions.create(project, {
      statement: 'Middleware covers all routes',
    });
    return repos.assumptions.updateStatus(
      project,
      assumption.id,
      'refuted',
      'Route inspection contradicts it',
    );
  })();

  await withClient(root, async (client) => {
    const claim = await createClaim(client);
    await addEvidence(client, claim, 'supports');
    const decision = {
      target_type: 'decision',
      decision: 'Deploy authentication changes',
      claim_ids: [claim.claim_id],
    };
    const pass = await review(client, decision);
    expect(pass).toMatchObject({
      status: 'pass_with_caveats',
      policy_version: 'provisional-1',
      claim_evaluations: [
        {
          claim_id: claim.claim_id,
          state: 'verified',
          assurance: 'provisional',
          criterion_evaluations: [
            {
              outcome: 'supported',
              criterion_id: claim.criteria[0].criterion_id,
              key: criterion.key,
            },
          ],
        },
      ],
      findings: [],
    });
    const refuted = await review(client, {
      ...decision,
      assumption_ids: [assumption.id],
    });
    expect(refuted).toMatchObject({
      status: 'blocked_recommendation',
      findings: [
        {
          rule_id: 'REFUTED_ASSUMPTION',
          severity: 'error',
          record_ids: [assumption.id],
        },
      ],
    });
    await addEvidence(client, claim, 'contradicts');
    const contradicted = await review(client, decision);
    expect(contradicted).toMatchObject({
      status: 'blocked_recommendation',
      claim_evaluations: [
        {
          state: 'contradicted',
          assurance: 'provisional',
          criteria_satisfied_as_reported: true,
          criterion_evaluations: [
            {
              outcome: 'conflicting_reports',
              criterion_id: claim.criteria[0].criterion_id,
              key: criterion.key,
            },
          ],
        },
      ],
      findings: [{ rule_id: 'CONTRADICTORY_EVIDENCE', severity: 'error' }],
    });
  });
});

test('invalid and out-of-scope references fail safely without saving a partial review', async () => {
  const foreign = (() => {
    using db = openTestDatabase();
    const repos = createRepositories(db);
    repos.projects.create('other-project');
    const claim = repos.claims.create('other-project', 'Other project claim', [
      criterion,
    ]);
    const assumption = repos.assumptions.create('other-project', {
      statement: 'Other project assumption',
    });
    return { claim, assumption };
  })();

  await withClient(root, async (client) => {
    const claim = await createClaim(client);
    const decision = {
      target_type: 'decision',
      decision: 'Deploy',
      claim_ids: [claim.claim_id],
    };
    for (const args of [
      { target_type: 'claim', target_id: randomUUID() },
      { target_type: 'claim', target_id: foreign.claim.id },
      {
        target_type: 'claim',
        target_id: claim.claim_id,
        project_id: 'missing-project',
      },
      { ...decision, claim_ids: [claim.claim_id, foreign.claim.id] },
      { ...decision, assumption_ids: [foreign.assumption.id] },
    ]) {
      const result = await client.callTool({
        name: 'cortex_review',
        arguments: { project_id: project, ...args },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: 'INVALID_REFERENCE',
        message: 'A review reference was not found in the given project.',
      });
    }

    for (const args of [
      { target_type: 'claim', target_id: 'malformed' },
      { ...decision, claim_ids: [] },
      {
        ...decision,
        claim_ids: [claim.claim_id, claim.claim_id.toUpperCase()],
      },
      {
        ...decision,
        claim_ids: Array.from({ length: 17 }, () => randomUUID()),
      },
      { ...decision, sensitive_field_name: 'sensitive_value' },
    ]) {
      const result = await client.callTool({
        name: 'cortex_review',
        arguments: { project_id: project, ...args },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('Input validation error');
      expect(JSON.stringify(result)).not.toContain('sensitive');
    }
  });

  using db = openTestDatabase();
  expect(db.prepare('SELECT count(*) AS count FROM reviews').get()).toEqual({
    count: 0,
  });
  expect(
    db.prepare('SELECT count(*) AS count FROM review_findings').get(),
  ).toEqual({ count: 0 });
});
