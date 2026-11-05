import * as z from 'zod/v4';
import {
  boundedText,
  description,
  id,
  inputId,
  label,
  objectOptions,
} from './fields.js';

export const assumptionStatus = z.enum([
  'unverified',
  'supported',
  'refuted',
  'inconclusive',
]);
export const confidence = z.number().min(0).max(1);

export const trackAssumptionInput = z.strictObject(
  {
    project_id: label,
    statement: description,
    context: boundedText(2000).optional(),
    confidence: confidence.optional(),
  },
  objectOptions,
);

export const trackAssumptionOutput = z.object({
  assumption_id: id,
  status: z.literal('unverified'),
});

export const updateAssumptionInput = z.strictObject(
  {
    project_id: label,
    assumption_id: inputId,
    status: assumptionStatus,
    reason: description,
  },
  objectOptions,
);

export const updateAssumptionOutput = z.object({
  assumption_id: id,
  status: assumptionStatus,
  updated_at: z.iso.datetime(),
});
