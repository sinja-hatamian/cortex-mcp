import type {
  Assumption,
  ClaimEvaluation,
  ClaimState,
  ClaimWithCriteria,
  Criterion,
  CriterionEvaluation,
  Evidence,
  ProjectPolicy,
  ReviewFinding,
  ReviewTarget,
} from './models.js';
import { criterionOutcomes } from './models.js';
import { compareText, orderFindings, type FindingRuleId } from './rules.js';

export const policyVersion = {
  strict: 'strict-1',
  provisional: 'provisional-1',
} as const satisfies Record<ProjectPolicy, string>;

type ClaimSnapshot = {
  claim: Pick<ClaimWithCriteria, 'id'> & {
    criteria: readonly Pick<Criterion, 'id' | 'key' | 'required'>[];
  };
  evidence: readonly Pick<
    Evidence,
    'id' | 'origin' | 'criterion_id' | 'relation'
  >[];
};

type DecisionStatus = Extract<
  ReviewTarget,
  { target_type: 'decision' }
>['status'];
const MAX_EVIDENCE_REFERENCES = 3;

function isAdmissible(
  origin: Evidence['origin'],
  policy: ProjectPolicy,
): boolean {
  return (
    policy === 'provisional' &&
    (origin === 'user_attested' || origin === 'tool_output_recorded')
  );
}

function evidenceFinding(
  ruleId: FindingRuleId,
  severity: ReviewFinding['severity'],
  claimId: string,
  evidenceIds: string[],
  message: string,
): ReviewFinding {
  return {
    rule_id: ruleId,
    severity,
    record_ids: [
      claimId,
      ...evidenceIds.sort().slice(0, MAX_EVIDENCE_REFERENCES),
    ],
    message,
  };
}

function criterionOutcome(
  hasSupport: boolean,
  hasContradiction: boolean,
  hasAdmissibleSupport: boolean,
): CriterionEvaluation['outcome'] {
  if (hasContradiction)
    return hasSupport ? 'conflicting_reports' : 'reported_failure';
  if (!hasSupport) return 'missing_evidence';
  return hasAdmissibleSupport ? 'supported' : 'unverified_source';
}

export function evaluateClaim(
  { claim, evidence }: ClaimSnapshot,
  policy: ProjectPolicy,
): { evaluation: ClaimEvaluation; findings: ReviewFinding[] } {
  const requiredCriteria = claim.criteria.filter(({ required }) => required);
  const requiredIds = requiredCriteria.map(({ id }) => id);
  const required = new Set(requiredIds);
  const reportedSupport = new Set<string>();
  const admissibleSupport = new Set<string>();
  const reportedContradictions = new Set<string>();
  const admissibleContradictions: string[] = [];
  const otherContradictions: string[] = [];
  const reportedOnly: string[] = [];

  for (const record of evidence) {
    if (record.relation === 'neutral') continue;
    const admissible = isAdmissible(record.origin, policy);
    if (!admissible) reportedOnly.push(record.id);

    const criterion = record.criterion_id;
    const isRequired = criterion !== null && required.has(criterion);
    if (record.relation === 'contradicts') {
      if (isRequired) reportedContradictions.add(criterion);
      (admissible && isRequired
        ? admissibleContradictions
        : otherContradictions
      ).push(record.id);
    } else if (isRequired) {
      reportedSupport.add(criterion);
      if (admissible) admissibleSupport.add(criterion);
    }
  }

  const missing = requiredIds.filter((id) => !reportedSupport.has(id));
  const complete = requiredIds.length > 0 && missing.length === 0;
  let state: ClaimState = 'unverified';
  if (admissibleContradictions.length) state = 'contradicted';
  else if (complete && admissibleSupport.size === requiredIds.length)
    state = 'verified';

  const evaluation: ClaimEvaluation = {
    claim_id: claim.id,
    state,
    criteria_satisfied_as_reported: complete,
    criterion_evaluations: requiredCriteria
      .map(({ id, key }) => ({
        outcome: criterionOutcome(
          reportedSupport.has(id),
          reportedContradictions.has(id),
          admissibleSupport.has(id),
        ),
        criterion_id: id,
        key,
      }))
      .sort(
        (left, right) =>
          criterionOutcomes.indexOf(left.outcome) -
            criterionOutcomes.indexOf(right.outcome) ||
          compareText(left.key, right.key),
      ),
  };
  if (state !== 'unverified') evaluation.assurance = 'provisional';
  else if (reportedOnly.length && !admissibleSupport.size)
    evaluation.assurance = 'reported_only';

  const findings: ReviewFinding[] = [];
  if (!complete) {
    findings.push({
      rule_id: 'MISSING_REQUIRED_EVIDENCE',
      severity: 'warning',
      record_ids: [claim.id, ...missing],
      message: requiredIds.length
        ? 'One or more required criteria lack linked supporting evidence.'
        : 'The claim has no required criteria.',
    });
  }
  if (state === 'unverified') {
    findings.push({
      rule_id: 'UNVERIFIED_CLAIM',
      severity: 'warning',
      record_ids: [claim.id],
      message: complete
        ? 'Reported support covers the required criteria, but the policy does not admit enough of it.'
        : 'The required criteria are incomplete under the current policy.',
    });
  }
  if (admissibleContradictions.length) {
    findings.push(
      evidenceFinding(
        'CONTRADICTORY_EVIDENCE',
        'error',
        claim.id,
        admissibleContradictions,
        `Admissible evidence contradicts a required criterion (${admissibleContradictions.length} records).`,
      ),
    );
  }
  if (otherContradictions.length) {
    findings.push(
      evidenceFinding(
        'CONTRADICTORY_EVIDENCE',
        'warning',
        claim.id,
        otherContradictions,
        `Contradictory records are outside the required criteria or inadmissible under the policy (${otherContradictions.length} records).`,
      ),
    );
  }
  if (reportedOnly.length) {
    findings.push(
      evidenceFinding(
        'REPORTED_ONLY_EVIDENCE',
        'warning',
        claim.id,
        reportedOnly,
        `The policy treats these supporting or contradicting records as reports only (${reportedOnly.length} records).`,
      ),
    );
  }

  return { evaluation, findings: orderFindings(findings) };
}

export function evaluateDecision(
  claims: readonly ClaimSnapshot[],
  assumptions: readonly Pick<Assumption, 'id' | 'status'>[],
  policy: ProjectPolicy,
): {
  status: DecisionStatus;
  claim_evaluations: ClaimEvaluation[];
  findings: ReviewFinding[];
} {
  const claimEvaluations = claims.map((claim) => evaluateClaim(claim, policy));
  const findings = claimEvaluations.flatMap((result) => result.findings);
  for (const assumption of assumptions) {
    if (assumption.status === 'refuted') {
      findings.push({
        rule_id: 'REFUTED_ASSUMPTION',
        severity: 'error',
        record_ids: [assumption.id],
        message: 'A referenced assumption is recorded as refuted.',
      });
    } else if (assumption.status !== 'supported') {
      findings.push({
        rule_id: 'UNRESOLVED_ASSUMPTION',
        severity: 'warning',
        record_ids: [assumption.id],
        message: 'A referenced assumption is recorded as unresolved.',
      });
    }
  }

  let status: DecisionStatus = 'pass_with_caveats';
  if (findings.some(({ severity }) => severity === 'error'))
    status = 'blocked_recommendation';
  else if (findings.some(({ severity }) => severity === 'warning'))
    status = 'warning';
  return {
    status,
    claim_evaluations: claimEvaluations
      .map(({ evaluation }) => evaluation)
      .sort((left, right) => compareText(left.claim_id, right.claim_id)),
    findings: orderFindings(findings),
  };
}
