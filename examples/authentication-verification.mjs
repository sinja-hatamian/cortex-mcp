import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const expectedTools = [
  'cortex_add_evidence',
  'cortex_create_claim',
  'cortex_get_context',
  'cortex_health',
  'cortex_review',
  'cortex_track_assumption',
  'cortex_update_assumption',
];
const project_id = 'authentication-example';

async function call(client, name, args) {
  const result = await client.callTool({
    name,
    arguments: { project_id, ...args },
  });
  assert.notEqual(
    result.isError,
    true,
    `${name} failed: ${JSON.stringify(result.content)}`,
  );
  assert.ok(
    result.structuredContent,
    `${name} should return structured content`,
  );
  return result.structuredContent;
}

export async function verifyAuthentication(withSession) {
  const saved = await withSession(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).sort(), expectedTools);
    const health = await client.callTool({
      name: 'cortex_health',
      arguments: {},
    });
    assert.deepEqual(health.content, [{ type: 'text', text: 'ok' }]);

    const claim = await call(client, 'cortex_create_claim', {
      statement: 'Protected routes deny unauthenticated requests',
      criteria: [
        {
          key: 'coverage',
          description: 'Integration tests cover protected routes',
          required: true,
        },
        {
          key: 'denial',
          description: 'Unauthenticated requests receive a denial response',
          required: true,
        },
      ],
    });
    assert.equal(claim.status, 'unverified');
    const [coverage, denial] = claim.criteria;
    const reportedEvidence = {
      claim_id: claim.claim_id,
      relation: 'supports',
      source_type: 'test',
      observed_at: '2026-11-05T00:00:00Z',
    };
    const target = { target_type: 'claim', target_id: claim.claim_id };

    const first = await call(client, 'cortex_add_evidence', {
      ...reportedEvidence,
      criterion_id: coverage.criterion_id,
      content_summary:
        'Caller reports that the integration suite covered the protected routes',
    });
    assert.equal(first.assurance, 'unverified_origin');
    const incomplete = await call(client, 'cortex_review', target);
    assert.equal(incomplete.status, 'unverified');
    assert.equal(
      incomplete.claim_evaluations[0].criteria_satisfied_as_reported,
      false,
    );
    assert.deepEqual(incomplete.claim_evaluations[0].criterion_evaluations, [
      { ...denial, outcome: 'missing_evidence' },
      { ...coverage, outcome: 'unverified_source' },
    ]);
    assert.ok(
      incomplete.findings.some(
        ({ rule_id, record_ids }) =>
          rule_id === 'MISSING_REQUIRED_EVIDENCE' &&
          record_ids.includes(denial.criterion_id),
      ),
    );

    const second = await call(client, 'cortex_add_evidence', {
      ...reportedEvidence,
      criterion_id: denial.criterion_id,
      origin: 'tool_output_recorded',
      content_summary:
        'Caller reports that the test output showed an HTTP 401 response',
    });
    assert.equal(second.assurance, 'unverified_origin');
    const reported = await call(client, 'cortex_review', target);
    assert.equal(reported.status, 'unverified');
    assert.equal(reported.policy_version, 'strict-1');
    assert.deepEqual(reported.claim_evaluations, [
      {
        claim_id: claim.claim_id,
        state: 'unverified',
        criteria_satisfied_as_reported: true,
        assurance: 'reported_only',
        criterion_evaluations: [coverage, denial].map((criterion) => ({
          ...criterion,
          outcome: 'unverified_source',
        })),
      },
    ]);

    const assumption = await call(client, 'cortex_track_assumption', {
      statement: 'The middleware is active on every protected route',
    });
    assert.equal(assumption.status, 'unverified');
    const reason =
      'Caller inspection reports that one route bypasses the middleware';
    const updated = await call(client, 'cortex_update_assumption', {
      assumption_id: assumption.assumption_id,
      status: 'refuted',
      reason,
    });
    assert.equal(updated.status, 'refuted');
    const decision = await call(client, 'cortex_review', {
      target_type: 'decision',
      decision: 'Deploy the authentication changes',
      claim_ids: [claim.claim_id],
      assumption_ids: [assumption.assumption_id],
    });
    assert.equal(decision.status, 'blocked_recommendation');
    assert.ok(
      decision.findings.some(({ rule_id }) => rule_id === 'REFUTED_ASSUMPTION'),
    );
    return { claim, incomplete, reported, assumption, decision, reason };
  });

  await withSession(async (client) => {
    const context = await call(client, 'cortex_get_context', {
      include: [
        'claims',
        'assumptions',
        'assumption_events',
        'evidence',
        'reviews',
      ],
    });
    assert.equal(context.claims[0].claim_id, saved.claim.claim_id);
    assert.equal(
      context.assumptions[0].assumption_id,
      saved.assumption.assumption_id,
    );
    assert.equal(context.assumptions[0].status, 'refuted');
    assert.equal(context.assumption_events[0].reason, saved.reason);
    assert.equal(context.evidence.length, 2);
    assert.ok(
      context.evidence.every(
        ({ assurance }) => assurance === 'unverified_origin',
      ),
    );
    assert.equal(context.reviews.length, 3);
    assert.ok(
      context.reviews.some(
        ({ review_id, status }) =>
          review_id === saved.decision.review_id &&
          status === 'blocked_recommendation',
      ),
    );
  });

  return {
    incomplete: saved.incomplete.status,
    reported: saved.reported.claim_evaluations[0],
    decision: saved.decision.status,
    recovered_after_restart: true,
  };
}

export async function runAuthenticationVerification({
  cwd,
  command = process.execPath,
  args = [fileURLToPath(new URL('../dist/cli.js', import.meta.url))],
}) {
  return verifyAuthentication(async (run) => {
    const client = new Client({
      name: 'cortex-authentication-example',
      version: '1.0.0',
    });
    const transport = new StdioClientTransport({
      command,
      args,
      cwd,
      env: { CORTEX_DATA_DIR: join(cwd, 'data') },
    });
    try {
      await client.connect(transport);
      return await run(client);
    } finally {
      await transport.close();
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cwd = await mkdtemp(join(tmpdir(), 'cortex-auth-example-'));
  try {
    const result = await runAuthenticationVerification({ cwd });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
