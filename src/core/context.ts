import type {
  Assumption,
  AssumptionEvent,
  Claim,
  CriterionInput,
  Evidence,
  ReviewTarget,
  TestRun,
} from './models.js';

export const contextCollections = [
  'claims',
  'assumptions',
  'assumption_events',
  'evidence',
  'reviews',
  'test_runs',
] as const;
export const MAX_CONTEXT_LIMIT = 20;
export type ContextCollection = (typeof contextCollections)[number];

export type ContextCriterion = Pick<CriterionInput, 'key' | 'required'> & {
  criterion_id: string;
};
type ContextClaim = Pick<Claim, 'statement' | 'created_at' | 'updated_at'> & {
  claim_id: string;
  criteria: ContextCriterion[];
};
type ContextAssumption = Omit<Assumption, 'id' | 'project_id'> & {
  assumption_id: string;
};
type ContextEvent = Omit<AssumptionEvent, 'id' | 'project_id'> & {
  event_id: string;
  position: number;
};
type ContextEvidence = Omit<Evidence, 'id' | 'project_id'> & {
  evidence_id: string;
  assurance: 'unverified_origin';
};
type ContextReview = Pick<ReviewTarget, 'target_type' | 'status'> & {
  review_id: string;
  claim_id: string | null;
  decision: string | null;
  policy_version: string;
  created_at: string;
};

export type ProjectContext = {
  project_id: string;
  claims?: ContextClaim[];
  assumptions?: ContextAssumption[];
  assumption_events?: ContextEvent[];
  evidence?: ContextEvidence[];
  reviews?: ContextReview[];
  test_runs?: TestRun[];
};
