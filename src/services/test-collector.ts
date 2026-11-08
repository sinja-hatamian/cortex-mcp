import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import * as z from 'zod/v4';
import type { TestRun } from '../core/models.js';
import { inputId, label } from '../schemas/fields.js';
import { testPaths } from '../schemas/test-runs.js';
import { openDatabase } from '../storage/db.js';
import { createRepositories } from '../storage/repositories/index.js';

const input = z
  .tuple([label, inputId, inputId, z.literal('--')])
  .rest(z.string());
const usage =
  'Usage: cortex-mcp collect-test <project-id> <claim-id> <criterion-id> -- <test-file> [...]';
const testTimeoutMs = 120_000;

class CollectorError extends Error {}

function git(cwd: string, args: string[], message: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new CollectorError(message);
  }
}

function cleanRevision(root: string): string {
  const status = git(
    root,
    [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ],
    'Could not read Git working tree status.',
  );
  if (status.length) {
    throw new CollectorError(
      'Test collection requires a clean Git working tree.',
    );
  }
  return git(
    root,
    ['rev-parse', '--verify', 'HEAD'],
    'Could not read the Git revision.',
  ).trim();
}

function trackedPaths(root: string, paths: readonly string[]): string[] {
  const normalized = paths.map((path) => {
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (
      isAbsolute(path) ||
      !rel ||
      rel === '..' ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel) ||
      /[?*]/.test(rel) ||
      rel.includes('[') ||
      !statSync(full, { throwIfNoEntry: false })?.isFile() ||
      realpathSync(full) !== full
    ) {
      throw new CollectorError(
        'Select regular test files by path relative to the Git root.',
      );
    }
    return rel.split(sep).join('/');
  });
  git(
    root,
    ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', ...normalized],
    'Selected test files must be tracked by Git.',
  );
  return normalized;
}

export function collectTestRun(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): TestRun {
  const parsed = input.safeParse(args);
  if (!parsed.success) throw new CollectorError(usage);
  const [projectId, claimId, criterionId, , ...paths] = parsed.data;
  if (!testPaths.safeParse(paths).success) throw new CollectorError(usage);

  const root = realpathSync(
    git(
      cwd,
      ['rev-parse', '--show-toplevel'],
      'Run the collector inside a Git checkout.',
    ).replace(/\r?\n$/, ''),
  );
  const test_paths = trackedPaths(root, paths);
  if (
    !testPaths.safeParse(test_paths).success ||
    new Set(test_paths).size !== test_paths.length
  ) {
    throw new CollectorError(
      'Select distinct test paths of at most 256 bytes each.',
    );
  }

  using db = openDatabase(env);
  const repos = createRepositories(db);
  const claim = repos.claims.find(projectId, claimId);
  if (!claim?.criteria.some(({ id }) => id === criterionId)) {
    throw new CollectorError(
      'The claim or criterion was not found in this project.',
    );
  }
  const revision = cleanRevision(root);
  const childEnv = { ...env };
  delete childEnv.NODE_OPTIONS;
  const child = spawnSync(
    process.execPath,
    ['--test', '--', ...test_paths.map((path) => resolve(root, path))],
    {
      cwd: root,
      env: childEnv,
      stdio: ['ignore', 2, 2],
      timeout: testTimeoutMs,
      killSignal: 'SIGKILL',
    },
  );
  if (child.error || child.status === null) {
    throw new CollectorError(
      'The Node test runner did not complete with an exit code.',
    );
  }
  if (cleanRevision(root) !== revision) {
    throw new CollectorError('The Git revision changed during the test run.');
  }
  return repos.testRuns.save(projectId, {
    claim_id: claimId,
    criterion_id: criterionId,
    revision,
    node_version: process.version,
    test_paths,
    exit_code: child.status,
  });
}

export function runTestCollector(args: readonly string[]): void {
  try {
    const receipt = collectTestRun(args, process.cwd(), process.env);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    process.exitCode = receipt.exit_code === 0 ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof CollectorError
        ? error.message
        : 'Could not collect the test run.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}
