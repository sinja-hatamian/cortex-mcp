import type { McpServer } from '@modelcontextprotocol/server';
import { reviewInput, reviewOutput } from '../../schemas/review.js';
import { createReview, InvalidReviewReference } from '../../services/review.js';
import type { createRepositories } from '../../storage/repositories/index.js';
import { toolError, toolResult } from './results.js';

export function registerReviewTool(
  server: McpServer,
  getRepositories: () => ReturnType<typeof createRepositories>,
): void {
  server.registerTool(
    'cortex_review',
    {
      description:
        'Review a claim or get an advisory decision recommendation under the project policy. A decision needs at least one claim or assumption reference.',
      inputSchema: reviewInput,
      outputSchema: reviewOutput,
    },
    (input) => {
      try {
        const {
          id,
          target_type,
          status,
          policy_version,
          claim_evaluations,
          findings,
        } = createReview(getRepositories(), input);
        return toolResult({
          review_id: id,
          target_type,
          status,
          policy_version,
          claim_evaluations,
          findings,
        });
      } catch (error) {
        if (error instanceof InvalidReviewReference) {
          return toolError(
            'INVALID_REFERENCE',
            'A review reference was not found in the given project.',
          );
        }
        return toolError('STORAGE_ERROR', 'Could not save the review.');
      }
    },
  );
}
