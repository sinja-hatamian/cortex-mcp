import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { runAuthenticationVerification } from '../examples/authentication-verification.mjs';
import manifest from '../package.json' with { type: 'json' };

const repository = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const npmCommand = windows ? process.execPath : 'npm';
const npmArgs = windows
  ? [
      join(
        dirname(process.execPath),
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      ),
    ]
  : [];
const npm = (args, cwd) =>
  execFileSync(npmCommand, [...npmArgs, ...args], { cwd, encoding: 'utf8' });

const root = await mkdtemp(join(tmpdir(), 'cortex-package-'));
try {
  await mkdir(join(root, 'consumer'));
  const consumer = await realpath(join(root, 'consumer'));
  const [packed] = JSON.parse(
    npm(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      repository,
    ),
  );
  assert.equal(packed.version, manifest.version);
  const entry = manifest.bin['cortex-mcp'].replace(/^\.\//, '');
  assert.ok(packed.files.some(({ path }) => path === entry));
  assert.ok(
    packed.files.every(
      ({ path }) =>
        path.startsWith('dist/') ||
        ['package.json', 'README.md', 'LICENSE'].includes(path),
    ),
  );

  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'cortex-package-smoke', private: true }),
  );
  npm(
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      join(root, packed.filename),
    ],
    consumer,
  );
  const bin = join(
    consumer,
    'node_modules',
    '.bin',
    windows ? 'cortex-mcp.cmd' : 'cortex-mcp',
  );
  await access(bin);
  const installedEntry = join(consumer, 'node_modules', manifest.name, entry);
  if (!windows)
    assert.equal(await realpath(bin), await realpath(installedEntry));

  const result = await runAuthenticationVerification({
    cwd: consumer,
    args: [
      '--permission',
      `--allow-fs-read=${consumer}`,
      `--allow-fs-write=${consumer}`,
      windows ? installedEntry : bin,
    ],
  });
  process.stdout.write(
    `Installed ${packed.filename} and ran the authentication scenario with runtime network access denied.\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
