export type ProjectPolicy = 'strict' | 'provisional';

export type Project = {
  project_id: string;
  policy: ProjectPolicy;
  created_at: string;
  updated_at: string;
};

type ProjectRecord = {
  id: string;
  project_id: string;
  created_at: string;
};

export type Claim = ProjectRecord & {
  statement: string;
  updated_at: string;
};

export type CriterionInput = {
  key: string;
  description: string;
  required: boolean;
};

export type Criterion = ProjectRecord &
  CriterionInput & {
    claim_id: string;
    updated_at: string;
  };

export type ClaimWithCriteria = Claim & { criteria: Criterion[] };

export type EvidenceInput = {
  claim_id: string;
  criterion_id?: string;
  origin: 'agent_reported' | 'user_attested' | 'tool_output_recorded';
  source_type:
    'test' | 'build' | 'log' | 'document' | 'manual_observation' | 'other';
  source_ref?: string;
  observed_at: string;
  relation: 'supports' | 'contradicts' | 'neutral';
  content_summary: string;
  artifact_digest?: string;
  collector?: string;
};

export type Evidence = ProjectRecord &
  Omit<
    EvidenceInput,
    'criterion_id' | 'source_ref' | 'artifact_digest' | 'collector'
  > & {
    criterion_id: string | null;
    source_ref: string | null;
    artifact_digest: string | null;
    collector: string | null;
    integrity_status: 'unverified' | 'digest_recorded';
  };

export type AssumptionStatus =
  'unverified' | 'supported' | 'refuted' | 'inconclusive';

export type AssumptionInput = {
  statement: string;
  context?: string;
  confidence?: number;
};

export type Assumption = ProjectRecord & {
  statement: string;
  context: string | null;
  confidence: number | null;
  status: AssumptionStatus;
  updated_at: string;
};

export type AssumptionEvent = ProjectRecord & {
  assumption_id: string;
  previous_status: AssumptionStatus;
  status: AssumptionStatus;
  reason: string;
};

export type ClaimState = 'unverified' | 'verified' | 'contradicted';

export type ClaimEvaluation = {
  claim_id: string;
  state: ClaimState;
  assurance?: 'reported_only' | 'provisional';
  criteria_satisfied_as_reported: boolean;
};

export type ReviewTarget =
  | { target_type: 'claim'; claim_id: string; status: ClaimState }
  | {
      target_type: 'decision';
      decision: string;
      claim_ids: readonly string[];
      assumption_ids: readonly string[];
      status: 'pass_with_caveats' | 'warning' | 'blocked_recommendation';
    };

export type ReviewFinding = {
  rule_id: string;
  severity: 'info' | 'warning' | 'error';
  record_ids: readonly string[];
  message: string;
};

export type ReviewInput = ReviewTarget & {
  policy_version: string;
  claim_evaluations: readonly ClaimEvaluation[];
  findings: readonly ReviewFinding[];
};

export type Review = ProjectRecord & ReviewInput;
