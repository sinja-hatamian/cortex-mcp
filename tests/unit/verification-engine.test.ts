import { expect, test } from 'vitest';
import type { Evidence } from '../../src/core/models.js';
import {
  evaluateClaim,
  evaluateDecision,
} from '../../src/core/verification-engine.js';

const claim = {
  id: 'claim',
  criteria: [
    { id: 'criterion-a', key: 'a', required: true },
    { id: 'criterion-b', key: 'b', required: true },
    { id: 'optional', key: 'optional', required: false },
  ],
};

function evidence(
  id: string,
  relation: Evidence['relation'],
  criterion_id: string | null,
  origin: Evidence['origin'] = 'agent_reported',
) {
  return { id, relation, criterion_id, origin };
}

const admittedSupport = [
  evidence('tool-pass', 'supports', 'criterion-a', 'tool_output_recorded'),
  evidence('attested-pass', 'supports', 'criterion-b', 'user_attested'),
];

test('missing, neutral, and unlinked evidence leave required criteria unsupported', () => {
  const records = [
    evidence('neutral', 'neutral', 'criterion-a', 'user_attested'),
    evidence('claim-only', 'supports', null, 'tool_output_recorded'),
    evidence('optional-support', 'supports', 'optional', 'user_attested'),
  ];
  const review = evaluateClaim({ claim, evidence: records }, 'provisional');
  expect(review.evaluation).toEqual({
    claim_id: claim.id,
    state: 'unverified',
    criteria_satisfied_as_reported: false,
    criterion_evaluations: [
      { outcome: 'missing_evidence', criterion_id: 'criterion-a', key: 'a' },
      { outcome: 'missing_evidence', criterion_id: 'criterion-b', key: 'b' },
    ],
  });
  expect(review.findings).toMatchObject([
    {
      rule_id: 'MISSING_REQUIRED_EVIDENCE',
      record_ids: ['claim', 'criterion-a', 'criterion-b'],
    },
    { rule_id: 'UNVERIFIED_CLAIM', record_ids: ['claim'] },
  ]);

  const optionalClaim = {
    ...claim,
    criteria: [claim.criteria[2]],
  };
  expect(
    evaluateClaim({ claim: optionalClaim, evidence: records }, 'provisional'),
  ).toMatchObject({
    evaluation: {
      state: 'unverified',
      criteria_satisfied_as_reported: false,
      criterion_evaluations: [],
    },
    findings: [
      { rule_id: 'MISSING_REQUIRED_EVIDENCE' },
      { rule_id: 'UNVERIFIED_CLAIM' },
    ],
  });
});

test('only eligible evidence can establish provisional verification', () => {
  const snapshot = { claim, evidence: admittedSupport };
  expect(evaluateClaim(snapshot, 'strict')).toMatchObject({
    evaluation: {
      state: 'unverified',
      assurance: 'reported_only',
      criteria_satisfied_as_reported: true,
      criterion_evaluations: [
        { outcome: 'unverified_source', criterion_id: 'criterion-a', key: 'a' },
        { outcome: 'unverified_source', criterion_id: 'criterion-b', key: 'b' },
      ],
    },
    findings: [
      { rule_id: 'REPORTED_ONLY_EVIDENCE' },
      { rule_id: 'UNVERIFIED_CLAIM' },
    ],
  });
  expect(evaluateClaim(snapshot, 'provisional')).toEqual({
    evaluation: {
      claim_id: claim.id,
      state: 'verified',
      assurance: 'provisional',
      criteria_satisfied_as_reported: true,
      criterion_evaluations: [
        { outcome: 'supported', criterion_id: 'criterion-a', key: 'a' },
        { outcome: 'supported', criterion_id: 'criterion-b', key: 'b' },
      ],
    },
    findings: [],
  });
  expect(
    evaluateClaim(
      {
        claim,
        evidence: [
          admittedSupport[0],
          evidence('agent-pass', 'supports', 'criterion-b'),
        ],
      },
      'provisional',
    ),
  ).toMatchObject({
    evaluation: {
      state: 'unverified',
      criteria_satisfied_as_reported: true,
      criterion_evaluations: [
        { outcome: 'unverified_source', criterion_id: 'criterion-b', key: 'b' },
        { outcome: 'supported', criterion_id: 'criterion-a', key: 'a' },
      ],
    },
    findings: [
      { rule_id: 'REPORTED_ONLY_EVIDENCE' },
      { rule_id: 'UNVERIFIED_CLAIM' },
    ],
  });
});

test('an admissible contradiction to a required criterion wins even if another criterion lacks evidence', () => {
  const snapshot = {
    claim,
    evidence: [
      admittedSupport[0],
      evidence('failed-test', 'contradicts', 'criterion-a', 'user_attested'),
    ],
  };
  expect(evaluateClaim(snapshot, 'provisional')).toMatchObject({
    evaluation: {
      state: 'contradicted',
      assurance: 'provisional',
      criteria_satisfied_as_reported: false,
      criterion_evaluations: [
        {
          outcome: 'conflicting_reports',
          criterion_id: 'criterion-a',
          key: 'a',
        },
        { outcome: 'missing_evidence', criterion_id: 'criterion-b', key: 'b' },
      ],
    },
    findings: [
      {
        rule_id: 'CONTRADICTORY_EVIDENCE',
        severity: 'error',
        record_ids: ['claim', 'failed-test'],
      },
      { rule_id: 'MISSING_REQUIRED_EVIDENCE', severity: 'warning' },
    ],
  });
  expect(evaluateClaim(snapshot, 'strict')).toMatchObject({
    evaluation: { state: 'unverified', assurance: 'reported_only' },
    findings: [
      { rule_id: 'CONTRADICTORY_EVIDENCE', severity: 'warning' },
      { rule_id: 'MISSING_REQUIRED_EVIDENCE', severity: 'warning' },
      { rule_id: 'REPORTED_ONLY_EVIDENCE', severity: 'warning' },
      { rule_id: 'UNVERIFIED_CLAIM', severity: 'warning' },
    ],
  });
});

test('other contradictions are warnings without changing the claim to contradicted', () => {
  const snapshot = {
    claim,
    evidence: [
      ...admittedSupport,
      evidence('agent-contradiction', 'contradicts', 'criterion-a'),
      evidence(
        'optional-contradiction',
        'contradicts',
        'optional',
        'tool_output_recorded',
      ),
      evidence('claim-contradiction', 'contradicts', null, 'user_attested'),
    ],
  };
  expect(evaluateDecision([snapshot], [], 'provisional')).toMatchObject({
    status: 'warning',
    claim_evaluations: [{ state: 'verified', assurance: 'provisional' }],
    findings: [
      {
        rule_id: 'CONTRADICTORY_EVIDENCE',
        severity: 'warning',
        record_ids: [
          'agent-contradiction',
          'claim',
          'claim-contradiction',
          'optional-contradiction',
        ],
      },
      { rule_id: 'REPORTED_ONLY_EVIDENCE', severity: 'warning' },
    ],
  });
});

test('decision status reflects refuted and unresolved assumptions with a supported case', () => {
  const claims = [{ claim, evidence: admittedSupport }];
  expect(
    evaluateDecision(
      claims,
      [{ id: 'assumption', status: 'supported' }],
      'provisional',
    ),
  ).toMatchObject({ status: 'pass_with_caveats', findings: [] });
  expect(
    evaluateDecision(
      claims,
      [{ id: 'assumption', status: 'unverified' }],
      'provisional',
    ),
  ).toMatchObject({
    status: 'warning',
    findings: [{ rule_id: 'UNRESOLVED_ASSUMPTION' }],
  });
  expect(
    evaluateDecision(
      claims,
      [
        { id: 'refuted', status: 'refuted' },
        { id: 'inconclusive', status: 'inconclusive' },
      ],
      'provisional',
    ),
  ).toMatchObject({
    status: 'blocked_recommendation',
    findings: [
      { rule_id: 'REFUTED_ASSUMPTION', severity: 'error' },
      { rule_id: 'UNRESOLVED_ASSUMPTION', severity: 'warning' },
    ],
  });
});

test('ordering and evidence samples are independent of record arrival order', () => {
  const reports = ['e', 'd', 'c', 'b', 'a'].map((id) =>
    evidence(id, 'contradicts', 'criterion-a'),
  );
  const snapshot = { claim, evidence: reports };
  const second = { claim: { ...claim, id: 'another-claim' }, evidence: [] };
  const assumptions = [
    { id: 'z-assumption', status: 'unverified' },
    { id: 'a-assumption', status: 'inconclusive' },
  ] as const;
  const first = evaluateDecision([snapshot, second], assumptions, 'strict');
  expect(first).toEqual(
    evaluateDecision(
      [
        second,
        {
          claim: { ...claim, criteria: [...claim.criteria].reverse() },
          evidence: [...reports].reverse(),
        },
      ],
      [...assumptions].reverse(),
      'strict',
    ),
  );
  expect(
    first.findings
      .filter(({ rule_id }) => rule_id === 'UNRESOLVED_ASSUMPTION')
      .map(({ record_ids }) => record_ids),
  ).toEqual([['a-assumption'], ['z-assumption']]);
  expect(first.findings[0]).toMatchObject({
    rule_id: 'CONTRADICTORY_EVIDENCE',
    record_ids: ['a', 'b', 'c', 'claim'],
    message: expect.stringContaining('5 records'),
  });
  expect(first.claim_evaluations[1].criterion_evaluations).toEqual([
    { outcome: 'reported_failure', criterion_id: 'criterion-a', key: 'a' },
    { outcome: 'missing_evidence', criterion_id: 'criterion-b', key: 'b' },
  ]);
});
