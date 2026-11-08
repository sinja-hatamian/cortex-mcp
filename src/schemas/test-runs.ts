import * as z from 'zod/v4';
import { boundedText, id } from './fields.js';

export const testPaths = z
  .array(boundedText(256).refine((path) => path.trim().length > 0))
  .min(1)
  .max(8);

export const testRunOutput = z.object({
  run_id: id,
  claim_id: id,
  criterion_id: id,
  revision: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  node_version: z.string(),
  test_paths: testPaths,
  exit_code: z.number().int(),
  created_at: z.iso.datetime(),
});
