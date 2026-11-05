import * as z from 'zod/v4';
import { MAX_CLAIM_CRITERIA } from '../core/models.js';
import {
  boundedText,
  description,
  id,
  inputId,
  label,
  objectOptions,
} from './fields.js';

const criterion = z.strictObject(
  { key: label, description, required: z.boolean() },
  objectOptions,
);
export const origin = z.enum([
  'agent_reported',
  'user_attested',
  'tool_output_recorded',
]);
export const sourceType = z.enum([
  'test',
  'build',
  'log',
  'document',
  'manual_observation',
  'other',
]);
export const relation = z.enum(['supports', 'contradicts', 'neutral']);
export const integrityStatus = z.enum(['unverified', 'digest_recorded']);
const sourceRef = boundedText(512);
const collector = boundedText(128);
const artifactDigest = z.string().regex(/^[a-f0-9]{64}$/i, {
  error: 'Expected a 64-character hexadecimal SHA-256 digest',
});
const utcTimestamp = z.iso.datetime();
const observedTimestamp = z.iso
  .datetime({ offset: true })
  .max(40)
  .refine(
    (value) => {
      const time = Date.parse(value);
      return (
        Number.isFinite(time) &&
        utcTimestamp.safeParse(new Date(time).toISOString()).success
      );
    },
    { error: 'Must represent a valid UTC timestamp with a four-digit year' },
  );

export const createClaimInput = z.strictObject(
  {
    project_id: label,
    statement: description,
    criteria: z
      .array(criterion)
      .min(1)
      .max(MAX_CLAIM_CRITERIA)
      .refine(
        (criteria) =>
          new Set(criteria.map(({ key }) => key)).size === criteria.length,
        { error: 'Criterion keys must be unique within a claim' },
      )
      .refine((criteria) => criteria.some(({ required }) => required), {
        error: 'A claim must have at least one required criterion',
      }),
  },
  objectOptions,
);

export const createClaimOutput = z.object({
  claim_id: id,
  criteria: z.array(z.object({ key: label, criterion_id: id })),
  status: z.literal('unverified'),
});

export const addEvidenceInput = z.strictObject(
  {
    project_id: label,
    claim_id: inputId,
    criterion_id: inputId.optional(),
    origin: origin.default('agent_reported'),
    source_type: sourceType,
    source_ref: sourceRef.optional(),
    observed_at: observedTimestamp,
    relation,
    content_summary: description,
    artifact_digest: artifactDigest.optional(),
    collector: collector.optional(),
  },
  objectOptions,
);

export const addEvidenceOutput = z.object({
  evidence_id: id,
  provenance: z.object({
    origin,
    source_type: sourceType,
    source_ref: sourceRef.nullable(),
    observed_at: utcTimestamp,
    artifact_digest: artifactDigest.nullable(),
    collector: collector.nullable(),
    integrity_status: integrityStatus,
  }),
  assurance: z.literal('unverified_origin'),
});
