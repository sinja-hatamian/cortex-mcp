import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  trackAssumptionOutput,
  updateAssumptionOutput,
} from '../../src/schemas/assumptions.js';
import { createClaimOutput } from '../../src/schemas/claims-evidence.js';
import { getContextOutput } from '../../src/schemas/context.js';
import { reviewOutput } from '../../src/schemas/review.js';
import { withClient } from './client.js';

const project = 'example-api';
const statement = 'Middleware covers the protected routes';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cortex-context-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function track(client: Client, project_id = project) {
  const result = await client.callTool({
    name: 'cortex_track_assumption',
    arguments: {
      project_id,
      statement,
      context: 'Before deployment',
      confidence: 0.6,
    },
  });
  expect(result.isError).not.toBe(true);
  return trackAssumptionOutput.parse(result.structuredContent);
}

async function getContext(client: Client, args: Record<string, unknown>) {
  const result = await client.callTool({
    name: 'cortex_get_context',
    arguments: { project_id: project, ...args },
  });
  expect(result.isError).not.toBe(true);
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify(result.structuredContent) },
  ]);
  return getContextOutput.parse(result.structuredContent);
}

test('recovers the assumption and its transitions after restart and uses it in a review', async () => {
  const { assumption_id, updated_at } = await withClient(
    root,
    async (client) => {
      const assumption = await track(client);
      expect(assumption.status).toBe('unverified');
      const update = async (status: string, reason: string) => {
        const result = await client.callTool({
          name: 'cortex_update_assumption',
          arguments: {
            project_id: project,
            assumption_id: assumption.assumption_id.toUpperCase(),
            status,
            reason,
          },
        });
        expect(result.isError).not.toBe(true);
        const saved = updateAssumptionOutput.parse(result.structuredContent);
        expect(saved).toMatchObject({
          assumption_id: assumption.assumption_id,
          status,
        });
        return saved;
      };
      await update('supported', 'The route group uses shared middleware');
      return update('refuted', 'The protected route bypasses the middleware');
    },
  );

  await withClient(root, async (client) => {
    const context = await getContext(client, {
      include: ['assumptions', 'assumption_events'],
    });
    expect(Object.keys(context)).toEqual([
      'project_id',
      'assumptions',
      'assumption_events',
    ]);
    expect(context.assumptions).toEqual([
      expect.objectContaining({
        assumption_id,
        statement,
        status: 'refuted',
        confidence: 0.6,
        updated_at,
      }),
    ]);
    expect(context.assumption_events).toHaveLength(2);
    expect(
      [...(context.assumption_events ?? [])].sort(
        (a, b) => a.position - b.position,
      ),
    ).toMatchObject([
      {
        assumption_id,
        position: 1,
        previous_status: 'unverified',
        status: 'supported',
        reason: 'The route group uses shared middleware',
      },
      {
        assumption_id,
        position: 2,
        previous_status: 'supported',
        status: 'refuted',
        reason: 'The protected route bypasses the middleware',
        created_at: updated_at,
      },
    ]);
    const review = await client.callTool({
      name: 'cortex_review',
      arguments: {
        project_id: project,
        target_type: 'decision',
        decision: 'Deploy',
        assumption_ids: [context.assumptions?.[0].assumption_id],
      },
    });
    expect(review.isError).not.toBe(true);
    const snapshot = reviewOutput.parse(review.structuredContent);
    expect(snapshot).toMatchObject({
      status: 'blocked_recommendation',
      findings: [
        { rule_id: 'REFUTED_ASSUMPTION', record_ids: [assumption_id] },
      ],
    });
    expect(
      await getContext(client, { include: ['reviews'], limit: 1 }),
    ).toMatchObject({
      reviews: [
        {
          review_id: snapshot.review_id,
          target_type: 'decision',
          status: 'blocked_recommendation',
          decision: 'Deploy',
          claim_id: null,
        },
      ],
    });
  });
});

test('recovers claim and criterion IDs and preserves evidence provenance', async () => {
  const claim = await withClient(root, async (client) => {
    const result = await client.callTool({
      name: 'cortex_create_claim',
      arguments: {
        project_id: project,
        statement: 'Protected routes deny unauthenticated requests',
        criteria: [
          {
            key: 'deny',
            description: 'An unauthenticated request is denied',
            required: true,
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    return createClaimOutput.parse(result.structuredContent);
  });

  await withClient(root, async (client) => {
    const context = await getContext(client, { include: ['claims'] });
    expect(context.claims?.[0].claim_id).toBe(claim.claim_id);
    expect(context.claims?.[0].criteria).toEqual([
      { ...claim.criteria[0], required: true },
    ]);
    const result = await client.callTool({
      name: 'cortex_add_evidence',
      arguments: {
        project_id: project,
        claim_id: context.claims?.[0].claim_id,
        criterion_id: context.claims?.[0].criteria[0].criterion_id,
        observed_at: '2026-11-05T00:00:00Z',
        content_summary: 'Caller reports an HTTP 401',
        relation: 'supports',
        origin: 'tool_output_recorded',
        source_type: 'test',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(
      await getContext(client, { include: ['evidence'], limit: 1 }),
    ).toMatchObject({
      evidence: [
        {
          claim_id: claim.claim_id,
          criterion_id: claim.criteria[0].criterion_id,
          origin: 'tool_output_recorded',
          assurance: 'unverified_origin',
        },
      ],
    });
  });
});

test('rejects missing and cross-project updates without exposing the other project in context', async () => {
  await withClient(root, async (client) => {
    const own = await track(client);
    const foreign = await track(client, 'foreign-api');
    for (const assumption_id of [foreign.assumption_id, randomUUID()]) {
      const result = await client.callTool({
        name: 'cortex_update_assumption',
        arguments: {
          project_id: project,
          assumption_id,
          status: 'refuted',
          reason: 'Rejected',
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: 'INVALID_REFERENCE',
        message: 'Assumption was not found in the given project.',
      });
    }
    const context = await getContext(client, {
      include: ['assumptions', 'assumption_events'],
    });
    expect(
      context.assumptions?.map(({ assumption_id }) => assumption_id),
    ).toEqual([own.assumption_id]);
    expect(context.assumption_events).toEqual([]);
    expect(
      await getContext(client, {
        project_id: 'missing',
        include: ['claims', 'reviews'],
      }),
    ).toEqual({
      project_id: 'missing',
      claims: [],
      reviews: [],
    });
  });
});

test('validates assumptions and bounded context arguments before opening storage', async () => {
  await withClient(root, async (client) => {
    const update = {
      assumption_id: randomUUID(),
      status: 'supported',
      reason: 'Observed',
    };
    const validContext = { include: ['claims'] };
    for (const [name, args] of [
      ['cortex_track_assumption', { statement, confidence: 1.1 }],
      ['cortex_track_assumption', { statement: '' }],
      ['cortex_update_assumption', { ...update, assumption_id: 'malformed' }],
      ['cortex_update_assumption', { ...update, status: 'verified' }],
      ['cortex_update_assumption', { ...update, reason: ' ' }],
      ['cortex_get_context', { include: [] }],
      ['cortex_get_context', { include: ['claims', 'claims'] }],
      ['cortex_get_context', { include: ['unknown'] }],
      ['cortex_get_context', { ...validContext, limit: 21 }],
      ['cortex_get_context', { ...validContext, limit: -1 }],
      ['cortex_get_context', { ...validContext, limit: 1.5 }],
      ['cortex_get_context', { ...validContext, sensitive_field: 'hidden' }],
    ] as const) {
      const result = await client.callTool({
        name,
        arguments: { project_id: project, ...args },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('Input validation error');
      expect(JSON.stringify(result)).not.toContain('sensitive_field');
    }
  });
  expect(await readdir(root)).toEqual([]);
});
