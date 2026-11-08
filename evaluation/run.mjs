import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { tasks } from './coding-tasks.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const rounds = 3;
const expectCriterionOutcomes = process.argv.includes(
  '--expect-criterion-outcomes',
);
const signalRules = new Set([
  'MISSING_REQUIRED_EVIDENCE',
  'CONTRADICTORY_EVIDENCE',
]);

function check([description, assertion], candidate) {
  try {
    assertion(candidate);
    return { description, passed: true };
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    return { description, passed: false, failure: error.message };
  }
}

async function checkCandidate(task, variant, root) {
  const directory = join(root, task.id, variant);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'candidate.mjs');
  await writeFile(file, task[variant]);
  const candidate = await import(pathToFileURL(file).href);
  return {
    primary: check(task.primary, candidate),
    edge: check(task.edge, candidate),
  };
}

async function review(client, task, project_id, reports) {
  let toolCalls = 0;
  async function call(name, args) {
    toolCalls += 1;
    const result = await client.callTool({
      name,
      arguments: { project_id, ...args },
    });
    assert.notEqual(
      result.isError,
      true,
      `${name} returned ${JSON.stringify(result.content)}`,
    );
    assert.ok(
      result.structuredContent,
      `${name} returned no structured content`,
    );
    return result.structuredContent;
  }
  const started = performance.now();
  const claim = await call('cortex_create_claim', {
    statement: task.statement,
    criteria: ['primary', 'edge'].map((key) => ({
      key,
      description: task[key][0],
      required: true,
    })),
  });
  for (const criterion of claim.criteria) {
    const outcome = reports[criterion.key];
    if (outcome === undefined) continue;
    const result = await call('cortex_add_evidence', {
      claim_id: claim.claim_id,
      criterion_id: criterion.criterion_id,
      source_type: 'test',
      origin: 'tool_output_recorded',
      relation: outcome ? 'supports' : 'contradicts',
      content_summary: `${task[criterion.key][0]}: caller reported ${outcome ? 'pass' : 'fail'}`,
      observed_at: new Date().toISOString(),
    });
    assert.equal(result.assurance, 'unverified_origin');
  }
  const result = await call('cortex_review', {
    target_type: 'decision',
    decision: 'Declare this coding task complete',
    claim_ids: [claim.claim_id],
  });
  const elapsedMs = performance.now() - started;
  const rules = [...new Set(result.findings.map(({ rule_id }) => rule_id))];
  assert.equal(result.policy_version, 'strict-1');
  const evaluation = result.claim_evaluations[0];
  if (expectCriterionOutcomes) {
    const { criterion_evaluations: outcomes } = evaluation;
    const expected = Object.fromEntries(
      claim.criteria.map(({ key, criterion_id }) => [
        key,
        {
          key,
          criterion_id,
          outcome:
            reports[key] === undefined
              ? 'missing_evidence'
              : reports[key]
                ? 'unverified_source'
                : 'reported_failure',
        },
      ]),
    );
    assert.deepEqual(outcomes, [expected.edge, expected.primary]);
    assert.equal(result.status, 'warning');
    assert.equal(evaluation.state, 'unverified');
  }
  return {
    decision: result.status,
    claim: evaluation.state,
    assurance: evaluation.assurance,
    criteria_satisfied_as_reported: evaluation.criteria_satisfied_as_reported,
    criterion_evaluations: evaluation.criterion_evaluations,
    rules,
    targetedSignal: rules.some((rule) => signalRules.has(rule)),
    toolCalls,
    elapsedMs,
  };
}

async function runRound(root, round, checks) {
  const client = new Client({
    name: 'cortex-coding-evaluation',
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    cwd: root,
    env: { CORTEX_DATA_DIR: join(root, `round-${round}`) },
  });
  const observations = [];
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, '0.1.0');
    for (const task of tasks) {
      const { first, corrected } = checks[task.id];
      const conditions = [
        {
          name: 'first_primary_only',
          actual: first,
          reports: { primary: first.primary.passed },
        },
        {
          name: 'first_failure_reported',
          actual: first,
          reports: { primary: first.primary.passed, edge: first.edge.passed },
        },
        {
          name: 'first_overstated',
          actual: first,
          reports: { primary: first.primary.passed, edge: true },
        },
        {
          name: 'corrected_primary_only',
          actual: corrected,
          reports: { primary: corrected.primary.passed },
        },
        {
          name: 'corrected_all_pass_reported',
          actual: corrected,
          reports: {
            primary: corrected.primary.passed,
            edge: corrected.edge.passed,
          },
        },
      ];
      // Vary the order by round so a condition does not always get the warmest server.
      const ordered = [
        ...conditions.slice(round - 1),
        ...conditions.slice(0, round - 1),
      ];
      for (const { name, actual, reports } of ordered) {
        observations.push({
          round,
          task: task.id,
          condition: name,
          acceptancePassed: actual.primary.passed && actual.edge.passed,
          baselineWouldDeclareComplete: Object.values(reports).every(Boolean),
          ...(await review(client, task, `${task.id}-${name}`, reports)),
        });
      }
    }
    return observations;
  } finally {
    await transport.close();
  }
}

function summarize(observations) {
  const groups = Map.groupBy(observations, ({ condition }) => condition);
  return Object.fromEntries(
    [...groups].map(([condition, rows]) => {
      const elapsed = rows
        .map(({ elapsedMs }) => elapsedMs)
        .sort((a, b) => a - b);
      const percentile = (p) =>
        Number(elapsed[Math.ceil(p * elapsed.length) - 1].toFixed(2));
      return [
        condition,
        {
          trials: rows.length,
          acceptancePasses: rows.filter(
            ({ acceptancePassed }) => acceptancePassed,
          ).length,
          baselineFalseCompletions: rows.filter(
            (row) => row.baselineWouldDeclareComplete && !row.acceptancePassed,
          ).length,
          targetedSignals: rows.filter(({ targetedSignal }) => targetedSignal)
            .length,
          targetedSignalsOnPassingCode: rows.filter(
            (row) => row.targetedSignal && row.acceptancePassed,
          ).length,
          falseCompletionsWithoutTargetedSignal: rows.filter(
            (row) =>
              row.baselineWouldDeclareComplete &&
              !row.acceptancePassed &&
              !row.targetedSignal,
          ).length,
          decisionWarnings: rows.filter(
            ({ decision }) => decision === 'warning',
          ).length,
          decisionBlocks: rows.filter(
            ({ decision }) => decision === 'blocked_recommendation',
          ).length,
          verifiedClaims: rows.filter(({ claim }) => claim === 'verified')
            .length,
          toolCallsPerTrial: rows[0].toolCalls,
          medianMs: percentile(0.5),
          p95Ms: percentile(0.95),
        },
      ];
    }),
  );
}

const root = await mkdtemp(join(tmpdir(), 'cortex-coding-evaluation-'));
try {
  const checks = {};
  for (const task of tasks) {
    const first = await checkCandidate(task, 'first', root);
    const corrected = await checkCandidate(task, 'corrected', root);
    assert.equal(first.primary.passed, true, task.id);
    assert.equal(first.edge.passed, false, task.id);
    assert.ok(corrected.primary.passed && corrected.edge.passed, task.id);
    checks[task.id] = { first, corrected };
  }
  const observations = [];
  for (let round = 1; round <= rounds; round += 1) {
    observations.push(...(await runRound(root, round, checks)));
  }
  const report = {
    cortexVersion: '0.1.0',
    nodeVersion: process.version,
    platform: process.platform,
    tasks: tasks.length,
    rounds,
    summary: summarize(observations),
    checks,
    observations,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
