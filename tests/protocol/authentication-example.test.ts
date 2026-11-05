import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

test('the authentication example exercises the six product tools across sessions', async () => {
  const example = fileURLToPath(
    new URL('../../examples/authentication-verification.mjs', import.meta.url),
  );
  const { stdout } = await promisify(execFile)(process.execPath, [example], {
    timeout: 10_000,
  });
  expect(JSON.parse(stdout)).toMatchObject({
    incomplete: 'unverified',
    reported: {
      state: 'unverified',
      assurance: 'reported_only',
      criteria_satisfied_as_reported: true,
    },
    decision: 'blocked_recommendation',
    recovered_after_restart: true,
  });
}, 12_000);
