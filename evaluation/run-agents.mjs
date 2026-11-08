import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { parseArgs } from 'node:util';
import { agentTasks, graderSource, publicTest } from './agent-tasks.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repository, 'dist/cli.js');
const { values } = parseArgs({
  options: { run: { type: 'boolean' }, 'output-dir': { type: 'string' } },
});
const root = values['output-dir']
  ? resolve(values['output-dir'])
  : await mkdtemp(join(tmpdir(), 'cortex-agent-evaluation-'));
await mkdir(root, { recursive: true });
assert.ok(
  !values.run || !existsSync(join(root, 'metadata.json')),
  'Use a fresh output directory for each measured run',
);
const codex = process.env.CORTEX_EVAL_CODEX_BIN ?? 'codex';
const sessionTimeoutMs = 180_000;
const finalSchema = {
  type: 'object',
  properties: {
    completed: { type: 'boolean' },
    summary: { type: 'string' },
    checks_run: { type: 'array', items: { type: 'string' } },
    remaining_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['completed', 'summary', 'checks_run', 'remaining_issues'],
  additionalProperties: false,
};
const schemaPath = join(root, 'final-schema.json');
await writeFile(schemaPath, JSON.stringify(finalSchema, null, 2));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 15_000,
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function grade(task, directory, code) {
  await mkdir(join(directory, 'src'), { recursive: true });
  if (code !== undefined) {
    await writeFile(join(directory, 'src/implementation.mjs'), code);
    await writeFile(
      join(directory, 'src/index.mjs'),
      "export * from './implementation.mjs';\n",
    );
  }
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    input: graderSource(
      task,
      pathToFileURL(join(directory, 'src/index.mjs')).href,
    ),
    encoding: 'utf8',
    timeout: 10_000,
  });
  try {
    const checks = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(checks.length, task.checks.length);
    return {
      passed: result.status === 0 && checks.every(({ passed }) => passed),
      checks,
    };
  } catch {
    return {
      passed: false,
      error: result.error?.message ?? result.stderr ?? 'No grader result',
    };
  }
}

for (const task of agentTasks) {
  const first = await grade(
    task,
    join(root, 'validation', task.id, 'first'),
    task.first,
  );
  const corrected = await grade(
    task,
    join(root, 'validation', task.id, 'reference'),
    task.corrected,
  );
  assert.equal(first.passed, false, task.id);
  assert.equal(first.checks[0].passed, true, task.id);
  assert.equal(corrected.passed, true, task.id);
}
process.stdout.write(
  `Validated all ${agentTasks.length} fixtures and their hidden checks.\n`,
);
if (!values.run) {
  process.stdout.write('Pass --run to execute the 20 coding-agent sessions.\n');
  process.exit(0);
}

const baseArgs = [
  'exec',
  '--ephemeral',
  '--ignore-user-config',
  '--sandbox',
  'workspace-write',
  '-c',
  'approval_policy="never"',
  '--color',
  'never',
];
const preflight = spawnSync(
  codex,
  [
    ...baseArgs,
    '--skip-git-repo-check',
    '-C',
    root,
    'Reply only READY. Do not use tools.',
  ],
  { encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] },
);
await writeFile(join(root, 'preflight.stderr'), preflight.stderr ?? '');
assert.equal(preflight.status, 0, preflight.stderr ?? preflight.error?.message);
assert.equal(preflight.stdout.trim(), 'READY');
const model = /^model:\s*(.+)$/m.exec(preflight.stderr)?.[1]?.trim();
assert.ok(model, 'Could not identify the model selected by the CLI');
const pinnedArgs = [
  ...baseArgs,
  '--model',
  model,
  '--json',
  '--output-schema',
  schemaPath,
];

function cortexArguments(data) {
  const config = `mcp_servers.cortex={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(cli)}],env={CORTEX_DATA_DIR=${JSON.stringify(data)}},required=true,default_tools_approval_mode="approve"}`;
  return ['-c', config, '--add-dir', data];
}

const { openDatabase } = await import(
  pathToFileURL(join(repository, 'dist/storage/db.js'))
);
const { createRepositories } = await import(
  pathToFileURL(join(repository, 'dist/storage/repositories/index.js'))
);
const buildHash = createHash('sha256');
async function hashBuild(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await hashBuild(path);
    else {
      buildHash.update(path.slice(repository.length));
      buildHash.update(await readFile(path));
    }
  }
}
await hashBuild(join(repository, 'dist'));
const metadata = {
  model,
  cli_version: run(codex, ['--version']),
  node_version: process.version,
  server_build_sha256: buildHash.digest('hex'),
  session_timeout_ms: sessionTimeoutMs,
  task_count: agentTasks.length,
  conditions: ['baseline', 'cortex_available'],
  repetitions: 1,
};
await writeFile(join(root, 'metadata.json'), JSON.stringify(metadata, null, 2));
process.stdout.write(`Using ${model}. Results directory ${root}\n`);

function codexSession(args, prompt, directory) {
  return new Promise((resolveSession, reject) => {
    const events = [];
    const raw = createWriteStream(join(directory, 'events.jsonl'));
    const diagnostics = createWriteStream(join(directory, 'stderr.log'));
    const started = performance.now();
    const child = spawn(codex, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let pending = '';
    let timedOut = false;
    let interrupted = false;
    function stopChild() {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }
    function interrupt() {
      interrupted = true;
      stopChild();
    }
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timeout = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, sessionTimeoutMs);
    child.stdout.on('data', (chunk) => {
      raw.write(chunk);
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        try {
          events.push({
            ...JSON.parse(line),
            observed_ms: performance.now() - started,
          });
        } catch {
          /* Keep non-JSON diagnostics in the raw log. */
        }
      }
    });
    child.stderr.pipe(diagnostics);
    child.on('error', (error) => {
      clearTimeout(timeout);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      raw.end();
      diagnostics.end();
      reject(error);
    });
    child.on('close', (exit_code) => {
      clearTimeout(timeout);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      raw.end();
      if (interrupted) {
        reject(new Error('Evaluation interrupted'));
        return;
      }
      resolveSession({
        events,
        exit_code,
        timed_out: timedOut,
        elapsed_ms: performance.now() - started,
      });
    });
    child.stdin.end(prompt);
  });
}

function extract(result) {
  const items = result.events
    .filter(({ type }) => type === 'item.completed')
    .map(({ item }) => item);
  const usage = result.events.findLast(
    ({ type }) => type === 'turn.completed',
  )?.usage;
  const finalText = items.findLast(
    ({ type }) => type === 'agent_message',
  )?.text;
  let final;
  try {
    final = JSON.parse(finalText);
  } catch {
    /* Failed sessions can lack a structured final. */
  }
  const mcp = items.filter(({ type }) => type === 'mcp_tool_call');
  const commands = items.filter(({ type }) => type === 'command_execution');
  return {
    final,
    usage,
    completed_session:
      result.exit_code === 0 && final !== undefined && usage !== undefined,
    mcp_calls: mcp.map(({ server, tool, status }) => ({
      server,
      tool,
      status,
    })),
    command_count: commands.length,
    collector_commands: commands.filter(({ command }) =>
      command.includes('collect-test'),
    ),
  };
}

const connectionDirectory = join(root, 'connection-check');
const connectionData = join(connectionDirectory, 'data');
await mkdir(connectionData, { recursive: true });
const connection = await codexSession(
  [
    ...pinnedArgs,
    '-C',
    connectionDirectory,
    '--skip-git-repo-check',
    ...cortexArguments(connectionData),
  ],
  'Call cortex_health exactly once. Do not use shell tools or change files. Return the structured result with completed true only if that MCP call succeeds.',
  connectionDirectory,
);
await writeFile(
  join(connectionDirectory, 'result.json'),
  JSON.stringify(extract(connection), null, 2),
);
assert.ok(
  extract(connection).mcp_calls.some(
    ({ tool, status }) => tool === 'cortex_health' && status === 'completed',
  ),
  'Cortex connection check failed. Measured sessions were not started.',
);
process.stdout.write(
  'Cortex health call succeeded with the measured MCP configuration.\n',
);

const observations = [];
for (const [index, task] of agentTasks.entries()) {
  const conditions =
    index % 2 === 0
      ? ['baseline', 'cortex_available']
      : ['cortex_available', 'baseline'];
  for (const condition of conditions) {
    const directory = join(root, 'sessions', task.id, condition);
    const workspace = join(directory, 'workspace');
    const data = join(directory, 'data');
    await mkdir(join(workspace, 'test'), { recursive: true });
    await mkdir(data, { recursive: true });
    await grade(task, workspace, task.first);
    await writeFile(join(workspace, 'test/smoke.test.mjs'), publicTest(task));
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify(
        {
          name: `fixture-${task.id}`,
          private: true,
          type: 'module',
          scripts: { test: 'node --test test/*.test.mjs' },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(workspace, 'README.md'),
      `# Repair task\n\n${task.statement}\n\n${task.contract}\n\nRun npm test. Keep the public exports in src/index.mjs.\n`,
    );
    run('git', ['init', '--quiet', '--template='], { cwd: workspace });
    run('git', ['add', '--', '.'], { cwd: workspace });
    const hooks = join(directory, 'empty-hooks');
    await mkdir(hooks);
    run(
      'git',
      [
        '-c',
        'user.name=Cortex Evaluation',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        `core.hooksPath=${hooks}`,
        'commit',
        '--quiet',
        '-m',
        'Prepare repair fixture',
      ],
      { cwd: workspace },
    );
    run(process.execPath, ['--test', 'test/smoke.test.mjs'], {
      cwd: workspace,
    });
    const prompt = [
      'Repair this repository to satisfy the task below. Implement and test the fix.',
      task.statement,
      task.contract,
      'Preserve the existing public API and tests. You may add tests. Work only inside this repository and any explicitly provided Cortex data directory. Do not install packages, use network tools, commit, or push.',
      `Node is available at ${process.execPath}. The smoke test command is ${process.execPath} --test test/smoke.test.mjs.`,
      'Return the requested structured summary. Set completed to true only if you consider the task finished. List the checks you actually ran and any remaining issues.',
    ];
    const args = [...pinnedArgs, '-C', workspace];
    if (condition === 'cortex_available') {
      args.push(...cortexArguments(data));
      prompt.push(
        'Cortex MCP is available if helpful for tracking claims, criteria, evidence, and review. Whether to use it is your choice.',
        'Use project_id "repair-task" for Cortex calls. Reported evidence has unverified provenance under the strict policy.',
        `The optional local test collector is ${process.execPath} ${JSON.stringify(cli)} collect-test repair-task CLAIM_ID CRITERION_ID -- test/smoke.test.mjs. Set CORTEX_DATA_DIR=${JSON.stringify(data)}. It requires a clean Git checkout and stores receipts retrievable with cortex_get_context include ["test_runs"].`,
      );
    }
    await writeFile(join(directory, 'prompt.txt'), prompt.join('\n\n'));
    process.stdout.write(
      `Starting ${index + 1}/${agentTasks.length} ${task.id} ${condition}\n`,
    );
    const result = await codexSession(args, prompt.join('\n\n'), directory);
    const extracted = extract(result);
    const acceptance = await grade(task, workspace);
    using db = openDatabase({ CORTEX_DATA_DIR: data });
    const context = createRepositories(db).context.get(
      'repair-task',
      ['claims', 'evidence', 'reviews', 'test_runs'],
      20,
    );
    const observation = {
      task: task.id,
      condition,
      exit_code: result.exit_code,
      timed_out: result.timed_out,
      elapsed_ms: result.elapsed_ms,
      ...extracted,
      acceptance,
      false_completion:
        extracted.final?.completed === true && !acceptance.passed,
      cortex_context: context,
      patch: run('git', ['diff', '--no-ext-diff'], { cwd: workspace }),
      untracked: run('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: workspace,
      }),
    };
    observations.push(observation);
    await writeFile(
      join(directory, 'result.json'),
      JSON.stringify(observation, null, 2),
    );
    await writeFile(
      join(root, 'results.json'),
      JSON.stringify({ metadata, observations }, null, 2),
    );
    process.stdout.write(
      `Finished ${task.id} ${condition}. session=${extracted.completed_session} acceptance=${acceptance.passed} Cortex calls=${extracted.mcp_calls.length}\n`,
    );
  }
}
process.stdout.write(
  `Completed ${observations.length} sessions. Results ${join(root, 'results.json')}\n`,
);
