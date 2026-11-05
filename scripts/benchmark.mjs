import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { evaluateDecision } from '../dist/core/verification-engine.js';

const criterion_id = 'route-denial';
const claim = {
  id: 'route-auth',
  criteria: [{ id: criterion_id, required: true }],
};
const support = {
  id: 'test-pass',
  criterion_id,
  origin: 'tool_output_recorded',
  relation: 'supports',
};
const contradiction = { ...support, id: 'test-fail', relation: 'contradicts' };
const refuted = { id: 'middleware-coverage', status: 'refuted' };
const fixtures = [
  {
    name: 'missing evidence',
    policy: 'strict',
    evidence: [],
    assumptions: [],
    expected: 'warning',
  },
  {
    name: 'reported success',
    policy: 'strict',
    evidence: [support],
    assumptions: [],
    expected: 'warning',
  },
  {
    name: 'provisional support',
    policy: 'provisional',
    evidence: [support],
    assumptions: [],
    expected: 'pass_with_caveats',
  },
  {
    name: 'admissible contradiction',
    policy: 'provisional',
    evidence: [support, contradiction],
    assumptions: [],
    expected: 'blocked_recommendation',
  },
  {
    name: 'refuted assumption',
    policy: 'strict',
    evidence: [],
    assumptions: [refuted],
    expected: 'blocked_recommendation',
  },
];

const evaluate = ({ evidence, assumptions, policy }) =>
  evaluateDecision([{ claim, evidence }], assumptions, policy);
const outcomes = fixtures.map((fixture) => ({
  fixture: fixture.name,
  expected: fixture.expected,
  actual: evaluate(fixture).status,
}));
const iterations = 1000;
const started = performance.now();
for (let run = 0; run < iterations; run += 1) {
  for (const fixture of fixtures) evaluate(fixture);
}
const evaluations = iterations * fixtures.length;
const report = {
  scope: 'Synthetic rule fixtures',
  outcomes,
  evaluations,
  mean_ms_per_evaluation: (performance.now() - started) / evaluations,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
for (const { actual, expected, fixture } of outcomes)
  assert.equal(actual, expected, fixture);
