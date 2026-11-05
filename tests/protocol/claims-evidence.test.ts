import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, expect, test } from 'vitest';
import { createClaimOutput } from '../../src/schemas/claims-evidence.js';
import { openDatabase } from '../../src/storage/db.js';
import { createRepositories } from '../../src/storage/repositories/index.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const tempRoots: string[] = [];
const claimInput = {
  project_id: 'example-api',
  statement: 'Protected routes reject unauthenticated requests',
  criteria: [
    { key: 'route-test', description: 'Run the route tests', required: true },
    {
      key: 'negative-test',
      description: 'Assert the denial response',
      required: true,
    },
  ],
};
const evidenceInput = {
  content_summary: 'Route integration tests passed',
  relation: 'supports',
  source_type: 'test',
  observed_at: '2026-11-05T03:30:00+03:30',
};

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cortex-tools-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function withClient<T>(
  cwd: string,
  run: (client: Client) => Promise<T>,
  dataDir = join(cwd, 'data'),
): Promise<T> {
  const client = new Client({ name: 'cortex-tools-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    cwd,
    env: { CORTEX_DATA_DIR: dataDir },
  });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await transport.close();
  }
}

async function createClaim(client: Client, projectId = claimInput.project_id) {
  const result = await client.callTool({
    name: 'cortex_create_claim',
    arguments: { ...claimInput, project_id: projectId },
  });
  expect(result.isError).not.toBe(true);
  return createClaimOutput.parse(result.structuredContent);
}

test('records scoped evidence and accepts the same claim after restarting the CLI', async () => {
  const root = await tempRoot();
  const claim = await withClient(root, async (client) => {
    const created = await createClaim(client);
    expect(created.status).toBe('unverified');
    expect(created.criteria.map(({ key }) => key)).toEqual([
      'route-test',
      'negative-test',
    ]);
    expect(created.criteria[0].criterion_id).not.toBe(
      created.criteria[1].criterion_id,
    );

    const evidence = await client.callTool({
      name: 'cortex_add_evidence',
      arguments: {
        ...evidenceInput,
        project_id: claimInput.project_id,
        claim_id: created.claim_id,
        criterion_id: created.criteria[0].criterion_id,
        origin: 'tool_output_recorded',
        source_ref: 'pnpm test:integration',
        artifact_digest: 'AB'.repeat(32),
        collector: 'integration-runner',
      },
    });
    expect(evidence.isError).not.toBe(true);
    expect(evidence.structuredContent).toEqual({
      evidence_id: expect.any(String),
      assurance: 'unverified_origin',
      provenance: {
        origin: 'tool_output_recorded',
        source_type: 'test',
        source_ref: 'pnpm test:integration',
        observed_at: '2026-11-05T00:00:00.000Z',
        artifact_digest: 'ab'.repeat(32),
        collector: 'integration-runner',
        integrity_status: 'digest_recorded',
      },
    });
    expect(evidence.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify(evidence.structuredContent),
      },
    ]);
    return created;
  });

  await withClient(root, async (client) => {
    const evidence = await client.callTool({
      name: 'cortex_add_evidence',
      arguments: {
        ...evidenceInput,
        project_id: claimInput.project_id,
        claim_id: claim.claim_id.toUpperCase(),
      },
    });
    expect(evidence.isError).not.toBe(true);
    expect(evidence.structuredContent).toMatchObject({
      assurance: 'unverified_origin',
      provenance: {
        origin: 'agent_reported',
        source_ref: null,
        artifact_digest: null,
        collector: null,
        integrity_status: 'unverified',
      },
    });
  });

  using db = openDatabase({ CORTEX_DATA_DIR: join(root, 'data') });
  const repos = createRepositories(db);
  expect(repos.projects.find(claimInput.project_id)?.policy).toBe('strict');
  expect(
    repos.claims.find(claimInput.project_id, claim.claim_id),
  ).toMatchObject({
    statement: claimInput.statement,
    criteria: claimInput.criteria,
  });
  const saved = repos.evidence.listForClaim(
    claimInput.project_id,
    claim.claim_id,
  );
  expect(saved).toHaveLength(2);
  expect(saved).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        claim_id: claim.claim_id,
        criterion_id: claim.criteria[0].criterion_id,
        origin: 'tool_output_recorded',
        content_summary: evidenceInput.content_summary,
      }),
      expect.objectContaining({
        claim_id: claim.claim_id,
        criterion_id: null,
        origin: 'agent_reported',
      }),
    ]),
  );
});

test('rejects invalid tool input before creating a database', async () => {
  const root = await tempRoot();
  await withClient(root, async (client) => {
    for (const invalid of [
      { criteria: [] },
      { criteria: [claimInput.criteria[0], claimInput.criteria[0]] },
      {
        criteria: Array.from({ length: 33 }, (_, i) => ({
          ...claimInput.criteria[0],
          key: String(i),
        })),
      },
      { statement: '界'.repeat(700) },
      { project_id: ' example-api ' },
      { criteria: [{ ...claimInput.criteria[0], required: 'true' }] },
      { sensitive_field_name: 'sensitive-value' },
    ]) {
      const result = await client.callTool({
        name: 'cortex_create_claim',
        arguments: { ...claimInput, ...invalid },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('Input validation error');
      expect(JSON.stringify(result)).not.toContain('sensitive');
    }
    for (const invalid of [
      { claim_id: 'not-a-uuid' },
      { criterion_id: 'not-a-uuid' },
      { observed_at: '2026-02-31T00:00:00Z' },
      { observed_at: '9999-12-31T23:59:59-01:00' },
      { artifact_digest: 'g'.repeat(64) },
      { origin: 'sensitive-value' },
      { source_ref: 'x'.repeat(513) },
    ]) {
      const result = await client.callTool({
        name: 'cortex_add_evidence',
        arguments: {
          ...evidenceInput,
          project_id: claimInput.project_id,
          claim_id: randomUUID(),
          ...invalid,
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('Input validation error');
      expect(JSON.stringify(result)).not.toContain('sensitive-value');
    }
  });
  expect(await readdir(root)).toEqual([]);
});

test('uses one safe error for missing and out-of-scope evidence references', async () => {
  const root = await tempRoot();
  {
    using db = openDatabase({ CORTEX_DATA_DIR: join(root, 'data') });
    createRepositories(db).projects.create(
      claimInput.project_id,
      'provisional',
    );
  }
  const claim = await withClient(root, async (client) => {
    const claim = await createClaim(client);
    const sibling = await createClaim(client);
    const foreign = await createClaim(client, 'other-api');
    for (const reference of [
      { project_id: 'unknown-project' },
      { claim_id: randomUUID() },
      { claim_id: foreign.claim_id },
      { criterion_id: randomUUID() },
      { criterion_id: sibling.criteria[0].criterion_id },
      { criterion_id: foreign.criteria[0].criterion_id },
    ]) {
      const result = await client.callTool({
        name: 'cortex_add_evidence',
        arguments: {
          ...evidenceInput,
          project_id: claimInput.project_id,
          claim_id: claim.claim_id,
          ...reference,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: 'INVALID_REFERENCE',
        message:
          'Claim or criterion was not found for the given project and claim.',
      });
    }
    return claim;
  });
  using db = openDatabase({ CORTEX_DATA_DIR: join(root, 'data') });
  const repos = createRepositories(db);
  expect(repos.projects.find(claimInput.project_id)?.policy).toBe(
    'provisional',
  );
  expect(repos.projects.find('unknown-project')).toBeUndefined();
  expect(
    repos.evidence.listForClaim(claimInput.project_id, claim.claim_id),
  ).toEqual([]);
  expect(db.prepare('SELECT count(*) AS count FROM evidence').get()).toEqual({
    count: 0,
  });
});

test('reports storage failures without revealing the configured filesystem path', async () => {
  const root = await tempRoot();
  const file = join(root, 'sensitive-storage-path');
  await writeFile(file, '');
  await withClient(
    root,
    async (client) => {
      const claim = await client.callTool({
        name: 'cortex_create_claim',
        arguments: claimInput,
      });
      expect(claim.isError).toBe(true);
      expect(claim.structuredContent).toEqual({
        code: 'STORAGE_ERROR',
        message: 'Could not save the claim.',
      });
      const health = await client.callTool({
        name: 'cortex_health',
        arguments: {},
      });
      expect(health.isError).not.toBe(true);
      expect(JSON.stringify(claim)).not.toContain('sensitive-storage-path');
    },
    file,
  );
});
