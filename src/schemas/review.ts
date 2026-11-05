import * as z from 'zod/v4';
import { findingRuleIds } from '../core/rules.js';
import { description, id, inputId, label, objectOptions } from './fields.js';

const references = z
  .array(inputId)
  .max(16)
  .refine((ids) => new Set(ids).size === ids.length, {
    error: 'Reference IDs must be unique',
  })
  .default([]);

export const reviewInput = z
  .discriminatedUnion('target_type', [
    z.strictObject(
      {
        project_id: label,
        target_type: z.literal('claim'),
        target_id: inputId,
      },
      objectOptions,
    ),
    z.strictObject(
      {
        project_id: label,
        target_type: z.literal('decision'),
        decision: description,
        claim_ids: references,
        assumption_ids: references,
      },
      objectOptions,
    ),
  ])
  .refine(
    (input) =>
      input.target_type === 'claim' ||
      input.claim_ids.length + input.assumption_ids.length > 0,
    { error: 'A decision must reference at least one claim or assumption' },
  );

export type ReviewRequest = z.output<typeof reviewInput>;

const claimState = z.enum(['unverified', 'verified', 'contradicted']);
const summary = {
  review_id: id,
  policy_version: z.string(),
  claim_evaluations: z.array(
    z.object({
      claim_id: id,
      state: claimState,
      assurance: z.enum(['reported_only', 'provisional']).optional(),
      criteria_satisfied_as_reported: z.boolean(),
    }),
  ),
  findings: z.array(
    z.object({
      rule_id: z.enum(findingRuleIds),
      severity: z.enum(['info', 'warning', 'error']),
      record_ids: z.array(id),
      message: z.string(),
    }),
  ),
};

export const reviewOutput = z.discriminatedUnion('target_type', [
  z.object({ ...summary, target_type: z.literal('claim'), status: claimState }),
  z.object({
    ...summary,
    target_type: z.literal('decision'),
    status: z.enum(['pass_with_caveats', 'warning', 'blocked_recommendation']),
  }),
]);
