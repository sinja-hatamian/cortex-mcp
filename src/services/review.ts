import type { Review } from '../core/models.js';
import { compareText } from '../core/rules.js';
import {
  evaluateClaim,
  evaluateDecision,
  policyVersion,
} from '../core/verification-engine.js';
import type { ReviewRequest } from '../schemas/review.js';
import type { createRepositories } from '../storage/repositories/index.js';

export class InvalidReviewReference extends Error {}

function requireReference<T>(record: T | undefined): T {
  if (record === undefined) throw new InvalidReviewReference();
  return record;
}

export function createReview(
  repositories: ReturnType<typeof createRepositories>,
  input: ReviewRequest,
): Review {
  const projectId = input.project_id;
  return repositories.reviews.saveFromSnapshot(projectId, () => {
    const { policy } = requireReference(repositories.projects.find(projectId));
    const policy_version = policyVersion[policy];
    const readClaim = (claimId: string) => ({
      claim: requireReference(repositories.claims.find(projectId, claimId)),
      evidence: repositories.evidence.listForClaim(projectId, claimId),
    });

    if (input.target_type === 'claim') {
      const { evaluation, findings } = evaluateClaim(
        readClaim(input.target_id),
        policy,
      );
      return {
        target_type: 'claim',
        claim_id: input.target_id,
        policy_version,
        status: evaluation.state,
        claim_evaluations: [evaluation],
        findings,
      };
    }

    const claimIds = [...input.claim_ids].sort(compareText);
    const assumptionIds = [...input.assumption_ids].sort(compareText);
    const claims = claimIds.map(readClaim);
    const assumptions = assumptionIds.map((id) =>
      requireReference(repositories.assumptions.find(projectId, id)),
    );
    return {
      target_type: 'decision',
      decision: input.decision,
      claim_ids: claimIds,
      assumption_ids: assumptionIds,
      policy_version,
      ...evaluateDecision(claims, assumptions, policy),
    };
  });
}
