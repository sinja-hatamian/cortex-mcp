import * as z from 'zod/v4';
import { contextCollections, MAX_CONTEXT_LIMIT } from '../core/context.js';
import { assumptionStatus, confidence } from './assumptions.js';
import {
  integrityStatus,
  origin,
  relation,
  sourceType,
} from './claims-evidence.js';
import { id, label, objectOptions } from './fields.js';
import { claimState, decisionStatus } from './review.js';
import { testRunOutput } from './test-runs.js';

export const getContextInput = z.strictObject(
  {
    project_id: label,
    include: z
      .array(z.enum(contextCollections))
      .min(1)
      .max(contextCollections.length)
      .refine(
        (collections) => new Set(collections).size === collections.length,
        { error: 'Collection names must be unique' },
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_CONTEXT_LIMIT)
      .default(MAX_CONTEXT_LIMIT),
  },
  objectOptions,
);

const created_at = z.iso.datetime();
const updated_at = created_at;
const timestamps = { created_at, updated_at };
const reviewFields = { review_id: id, policy_version: z.string(), created_at };

export const getContextOutput = z.object({
  project_id: label,
  claims: z
    .array(
      z.object({
        claim_id: id,
        statement: z.string(),
        criteria: z.array(
          z.object({
            criterion_id: id,
            key: z.string(),
            required: z.boolean(),
          }),
        ),
        ...timestamps,
      }),
    )
    .optional(),
  assumptions: z
    .array(
      z.object({
        assumption_id: id,
        statement: z.string(),
        context: z.string().max(2000).nullable(),
        confidence: confidence.nullable(),
        status: assumptionStatus,
        ...timestamps,
      }),
    )
    .optional(),
  assumption_events: z
    .array(
      z.object({
        event_id: id,
        assumption_id: id,
        position: z.number().int().positive(),
        previous_status: assumptionStatus,
        status: assumptionStatus,
        reason: z.string(),
        created_at,
      }),
    )
    .optional(),
  evidence: z
    .array(
      z.object({
        evidence_id: id,
        claim_id: id,
        criterion_id: id.nullable(),
        origin,
        source_type: sourceType,
        source_ref: z.string().max(512).nullable(),
        observed_at: z.string(),
        relation,
        content_summary: z.string(),
        artifact_digest: z.string().length(64).nullable(),
        collector: z.string().max(128).nullable(),
        integrity_status: integrityStatus,
        assurance: z.literal('unverified_origin'),
        created_at,
      }),
    )
    .optional(),
  reviews: z
    .array(
      z.discriminatedUnion('target_type', [
        z.object({
          ...reviewFields,
          target_type: z.literal('claim'),
          claim_id: id,
          decision: z.null(),
          status: claimState,
        }),
        z.object({
          ...reviewFields,
          target_type: z.literal('decision'),
          claim_id: z.null(),
          decision: z.string(),
          status: decisionStatus,
        }),
      ]),
    )
    .optional(),
  test_runs: z.array(testRunOutput).optional(),
});
