import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createClaimOutput } from '../../src/schemas/claims-evidence.js';
import { getContextOutput } from '../../src/schemas/context.js';
import { testRunOutput } from '../../src/schemas/test-runs.js';
import { collectTestRun } from '../../src/services/test-collector.js';
import { openDatabase } from '../../src/storage/db.js';
import { createRepositories } from '../../src/storage/repositories/index.js';
import { withClient } from './client.js';

vi.mock('node:child_process', { spy: true });

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const project = 'collector-api';
const criterion = {
  key: 'route-test',
  description: 'Run the route test',
  required: true,
};
let root: string;
let checkout: string;
let env: NodeJS.ProcessEnv;

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cortex-collector-'));
  checkout = join(root, 'fixture checkout');
  const hooks = join(root, 'empty hooks');
  env = { ...process.env, CORTEX_DATA_DIR: join(root, 'data') };
  await mkdir(checkout);
  await mkdir(hooks);
  git('init', '--quiet', '--template=');
  await Promise.all([
    writeFile(
      join(checkout, 'route pass.test.mjs'),
      "import test from 'node:test'; test('passes', () => {});",
    ),
    writeFile(
      join(checkout, 'route-fail.test.mjs'),
      "import test from 'node:test'; test('fails', () => { throw Error('fixture failure'); });",
    ),
    writeFile(
      join(checkout, 'writes.test.mjs'),
      "import test from 'node:test'; import { writeFileSync } from 'node:fs'; test('writes', () => writeFileSync('created.txt', 'test output'));",
    ),
  ]);
  git('add', '--', '.');
  git(
    '-c',
    'user.name=Cortex Fixture',
    '-c',
    'user.email=cortex@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    `core.hooksPath=${hooks}`,
    'commit',
    '--quiet',
    '-m',
    'Add fixture tests',
  );
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({
    name,
    arguments: { project_id: project, ...args },
  });
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}

async function runs(client: Client, projectId = project, limit = 20) {
  return getContextOutput.parse(
    await call(client, 'cortex_get_context', {
      project_id: projectId,
      include: ['test_runs'],
      limit,
    }),
  ).test_runs;
}

function run(
  projectId: string,
  claimId: string,
  criterionId: string,
  path: string,
) {
  return spawnSync(
    process.execPath,
    [cli, 'collect-test', projectId, claimId, criterionId, '--', path],
    {
      cwd: checkout,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}

test('collects passing and failing exits and recovers them across MCP sessions', async () => {
  const { claim_id, criteria } = await withClient(root, async (client) => {
    const claim = createClaimOutput.parse(
      await call(client, 'cortex_create_claim', {
        statement: 'Protected routes pass the acceptance check',
        criteria: [criterion],
      }),
    );
    await call(client, 'cortex_add_evidence', {
      claim_id: claim.claim_id,
      criterion_id: claim.criteria[0].criterion_id,
      origin: 'tool_output_recorded',
      collector: 'collect-test',
      source_type: 'test',
      relation: 'supports',
      content_summary: 'Caller claims a pass',
      observed_at: new Date().toISOString(),
    });
    expect(await runs(client)).toEqual([]);
    return claim;
  });
  const { criterion_id } = criteria[0];
  const revision = git('rev-parse', 'HEAD');
  const invalid = run(
    'other-project',
    claim_id,
    criterion_id,
    'route pass.test.mjs',
  );
  expect(invalid).toMatchObject({
    status: 2,
    stdout: '',
    stderr: expect.stringContaining('not found'),
  });

  const receipts = ['route pass.test.mjs', 'route-fail.test.mjs'].map(
    (path, exitCode) => {
      const result = run(project, claim_id, criterion_id, path);
      expect(result).toMatchObject({
        status: exitCode,
        stderr: expect.stringContaining(
          exitCode ? 'fixture failure' : 'passes',
        ),
      });
      const receipt = testRunOutput.parse(JSON.parse(result.stdout));
      expect(receipt).toMatchObject({
        claim_id,
        criterion_id,
        revision,
        node_version: process.version,
        test_paths: [path],
        exit_code: exitCode,
      });
      return receipt;
    },
  );

  const modifiesCheckout = run(
    project,
    claim_id,
    criterion_id,
    'writes.test.mjs',
  );
  expect(modifiesCheckout).toMatchObject({
    status: 2,
    stdout: '',
    stderr: expect.stringContaining('clean Git working tree'),
  });
  const dirty = run(project, claim_id, criterion_id, 'route pass.test.mjs');
  expect(dirty).toMatchObject({
    status: 2,
    stdout: '',
    stderr: 'Test collection requires a clean Git working tree.\n',
  });

  await withClient(root, async (client) => {
    expect(await runs(client)).toEqual([...receipts].reverse());
    expect(await runs(client, project, 1)).toEqual([receipts[1]]);
    expect(await runs(client, 'other-project')).toEqual([]);
    expect(
      await call(client, 'cortex_review', {
        target_type: 'claim',
        target_id: claim_id,
      }),
    ).toMatchObject({ status: 'unverified', policy_version: 'strict-1' });
  });
}, 15_000);

test('a failed Node launch leaves no receipt', () => {
  using db = openDatabase(env);
  const repos = createRepositories(db);
  repos.projects.create(project);
  const claim = repos.claims.create(project, 'Run a test', [criterion]);
  vi.mocked(spawnSync).mockReturnValueOnce({
    error: new Error('fixture spawn failure'),
    status: null,
    signal: null,
    pid: 0,
    output: [],
    stdout: '',
    stderr: '',
  });
  expect(() =>
    collectTestRun(
      [project, claim.id, claim.criteria[0].id, '--', 'route pass.test.mjs'],
      checkout,
      env,
    ),
  ).toThrow('The Node test runner did not complete with an exit code.');
  expect(repos.testRuns.list(project, 20)).toEqual([]);
});
