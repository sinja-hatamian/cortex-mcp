import assert from 'node:assert/strict';
import { tasks } from './coding-tasks.mjs';

const specifications = [
  {
    id: 'tenant-access',
    contract:
      'read(docs, user, id) returns the first matching document in user.tenant, or undefined. Document IDs can repeat across tenants. Keep the stored object identity.',
    checks: [
      [
        'Search past a foreign document with the same ID',
        ({ read }) => {
          const own = { id: 'invoice', tenant: 'a' };
          assert.equal(
            read(
              [{ id: 'invoice', tenant: 'b' }, own],
              { tenant: 'a' },
              'invoice',
            ),
            own,
          );
          assert.equal(read([], { tenant: 'a' }, 'missing'), undefined);
        },
      ],
    ],
  },
  {
    id: 'retry-idempotency',
    contract:
      'submit(payments, key, amount) appends a new payment once per key. Retrying a key preserves its original amount. Other keys remain independent. Return value is unspecified.',
    checks: [
      [
        'Retries preserve the first amount and independent keys',
        ({ submit }) => {
          const payments = [];
          submit(payments, 'one', 0);
          submit(payments, 'one', 200);
          submit(payments, 'two', 300);
          assert.deepEqual(payments, [
            { key: 'one', amount: 0 },
            { key: 'two', amount: 300 },
          ]);
        },
      ],
    ],
  },
  {
    id: 'cache-scope',
    contract:
      'key(account, user) deterministically encodes two arbitrary strings. Different account/user pairs must have distinct keys, including strings containing delimiters or empty strings.',
    checks: [
      [
        'Delimiter-containing pairs and empty strings stay distinct',
        ({ key }) => {
          const pairs = [
            ['a:b', 'c'],
            ['a', 'b:c'],
            ['', 'a'],
            ['a', ''],
            ['', ''],
          ];
          assert.equal(
            new Set(pairs.map(([account, user]) => key(account, user))).size,
            pairs.length,
          );
        },
      ],
    ],
  },
  {
    id: 'pagination-ties',
    contract:
      'after(rows, cursor) returns rows after a cursor ordered by numeric time, then numeric id. Preserve the input row order and objects. Do not repeat the cursor or mutate rows.',
    checks: [
      [
        'Mixed cursor boundaries preserve original rows',
        ({ after }) => {
          const rows = [
            { time: 0, id: 9 },
            { time: 1, id: 1 },
            { time: 1, id: 2 },
            { time: 2, id: 0 },
          ];
          const original = JSON.parse(JSON.stringify(rows));
          assert.deepEqual(after(rows, { time: 1, id: 1 }), rows.slice(2));
          assert.deepEqual(rows, original);
          assert.deepEqual(after([], { time: 1, id: 1 }), []);
        },
      ],
    ],
  },
  {
    id: 'atomic-batch',
    contract:
      'append(target, items) appends positive integers in order. Throw for zero, negative, fractional, or nonnumeric items. Any invalid item leaves target untouched. An empty batch succeeds.',
    checks: [
      [
        'Validation rejects the whole batch for each invalid item',
        ({ append }) => {
          for (const invalid of [-1, 1.5, '2', null, NaN]) {
            const target = [7];
            assert.throws(() => append(target, [1, invalid]));
            assert.deepEqual(target, [7]);
          }
          const target = [7];
          append(target, []);
          assert.deepEqual(target, [7]);
        },
      ],
    ],
  },
  {
    id: 'asset-path',
    contract:
      'asset(root, name) resolves POSIX asset paths. Reject every absolute name and any name that resolves outside root, including a sibling sharing the root prefix. Nested relative paths are allowed.',
    checks: [
      [
        'Sibling prefixes and normalized traversal cannot escape',
        ({ asset }) => {
          assert.throws(() => asset('/app/assets', '../assets-other/file'));
          assert.throws(() => asset('/app/assets', 'images/../../secret'));
          assert.throws(() => asset('/app/assets', '/app/assets/logo.svg'));
          assert.equal(
            asset('/app/assets/', './images/../logo.svg'),
            '/app/assets/logo.svg',
          );
        },
      ],
    ],
  },
  {
    id: 'webhook-retry',
    contract:
      'retry(status) accepts a numeric HTTP status and returns true exactly for 429 or 500 through 599 inclusive. All other numeric values return false.',
    checks: [
      [
        'Retry eligibility respects both server-error boundaries',
        ({ retry }) => {
          for (const status of [429, 500, 599])
            assert.equal(retry(status), true);
          for (const status of [200, 399, 400, 499, 600])
            assert.equal(retry(status), false);
        },
      ],
    ],
  },
  {
    id: 'log-redaction',
    contract:
      'redact(value) removes properties named token at every depth of JSON-like objects and arrays. Preserve other values, including primitives and null. Do not mutate the input.',
    checks: [
      [
        'Nested redaction preserves primitives and the input',
        ({ redact }) => {
          const input = {
            token: 'top',
            nested: {
              token: 'nested',
              keep: [null, 1, { token: 'deep', ok: false }],
            },
          };
          const original = JSON.parse(JSON.stringify(input));
          assert.deepEqual(redact(input), {
            nested: { keep: [null, 1, { ok: false }] },
          });
          assert.deepEqual(input, original);
          assert.equal(redact(null), null);
          assert.equal(redact('text'), 'text');
        },
      ],
    ],
  },
  {
    id: 'cart-quantity',
    contract:
      'total(items) sums cents times quantity using integer cent amounts and nonnegative integer quantities. Empty carts and zero quantities total zero. Preserve the items.',
    checks: [
      [
        'Empty and mixed-quantity carts keep cent arithmetic',
        ({ total }) => {
          assert.equal(total([]), 0);
          const items = [
            { cents: 105, quantity: 2 },
            { cents: 199, quantity: 3 },
            { cents: 999, quantity: 0 },
          ];
          const original = JSON.parse(JSON.stringify(items));
          assert.equal(total(items), 807);
          assert.deepEqual(items, original);
        },
      ],
    ],
  },
  {
    id: 'search-normalization',
    contract:
      'matches(label, query) performs case-insensitive substring search with NFC-equivalent Unicode text. Normalize both arguments. An empty query matches. Accents retain their meaning.',
    checks: [
      [
        'Normalization works in both directions without removing accents',
        ({ matches }) => {
          assert.equal(matches('Cafe\u0301 MENU', 'FÉ'), true);
          assert.equal(matches('Café', ''), true);
          assert.equal(matches('Café', 'cafe'), false);
          assert.equal(matches('Build', 'missing'), false);
        },
      ],
    ],
  },
];

export const agentTasks = specifications.map((specification) => {
  const task = tasks.find(({ id }) => id === specification.id);
  assert.ok(task, specification.id);
  return {
    ...task,
    ...specification,
    checks: [task.primary, task.edge, ...specification.checks],
  };
});

export function publicTest(task) {
  return [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import * as candidate from '../src/index.mjs';",
    `test(${JSON.stringify(task.primary[0])}, () => (${task.primary[1].toString()})(candidate));`,
    '',
  ].join('\n');
}

export function graderSource(task, moduleUrl) {
  return `
import assert from 'node:assert/strict';
const candidate = await import(${JSON.stringify(moduleUrl)});
const checks = [${task.checks.map(([name, check]) => `[${JSON.stringify(name)}, ${check.toString()}]`).join(',')}];
const results = checks.map(([name, check]) => {
  try { check(candidate); return { name, passed: true }; }
  catch (error) { return { name, passed: false, error: error.message }; }
});
process.stdout.write(JSON.stringify(results) + '\\n');
`;
}
