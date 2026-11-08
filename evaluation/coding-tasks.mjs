import assert from 'node:assert/strict';

export const tasks = [
  {
    id: 'tenant-access',
    statement: 'Return a document only to a user in the same tenant.',
    first:
      'export const read = (docs, user, id) => docs.find(doc => doc.id === id);',
    corrected:
      'export const read = (docs, user, id) => docs.find(doc => doc.id === id && doc.tenant === user.tenant);',
    primary: [
      'A user can read their own tenant’s document',
      ({ read }) => {
        const doc = { id: 'invoice', tenant: 'a' };
        assert.equal(read([doc], { tenant: 'a' }, 'invoice'), doc);
      },
    ],
    edge: [
      'A user cannot read another tenant’s document',
      ({ read }) => {
        assert.equal(
          read([{ id: 'invoice', tenant: 'b' }], { tenant: 'a' }, 'invoice'),
          undefined,
        );
      },
    ],
  },
  {
    id: 'retry-idempotency',
    statement: 'Record a payment request exactly once per idempotency key.',
    first:
      'export const submit = (payments, key, amount) => payments.push({ key, amount });',
    corrected:
      'export function submit(payments, key, amount) { if (!payments.some(payment => payment.key === key)) payments.push({ key, amount }); }',
    primary: [
      'A new payment is stored',
      ({ submit }) => {
        const payments = [];
        submit(payments, 'order-1', 100);
        assert.deepEqual(payments, [{ key: 'order-1', amount: 100 }]);
      },
    ],
    edge: [
      'A retry cannot store a second payment',
      ({ submit }) => {
        const payments = [];
        submit(payments, 'order-1', 100);
        submit(payments, 'order-1', 100);
        assert.equal(payments.length, 1);
      },
    ],
  },
  {
    id: 'cache-scope',
    statement: 'Cache a user profile within the requesting account.',
    first: 'export const key = (account, user) => JSON.stringify(user);',
    corrected:
      'export const key = (account, user) => JSON.stringify([account, user]);',
    primary: [
      'Repeated reads in one account produce the same key',
      ({ key }) => {
        assert.equal(key('a', 'user'), key('a', 'user'));
      },
    ],
    edge: [
      'The same user ID in two accounts has distinct keys',
      ({ key }) => {
        assert.notEqual(key('a', 'user'), key('b', 'user'));
      },
    ],
  },
  {
    id: 'pagination-ties',
    statement:
      'Resume a page after the cursor, including rows sharing its timestamp.',
    first:
      'export const after = (rows, cursor) => rows.filter(row => row.time > cursor.time);',
    corrected:
      'export const after = (rows, cursor) => rows.filter(row => row.time > cursor.time || (row.time === cursor.time && row.id > cursor.id));',
    primary: [
      'A row with a later timestamp is returned',
      ({ after }) => {
        assert.deepEqual(after([{ time: 2, id: 1 }], { time: 1, id: 1 }), [
          { time: 2, id: 1 },
        ]);
      },
    ],
    edge: [
      'The next ID at the same timestamp is returned without repeating the cursor',
      ({ after }) => {
        assert.deepEqual(
          after(
            [
              { time: 1, id: 1 },
              { time: 1, id: 2 },
            ],
            { time: 1, id: 1 },
          ),
          [{ time: 1, id: 2 }],
        );
      },
    ],
  },
  {
    id: 'feature-flag',
    statement: 'Use the default only when the feature flag is absent.',
    first: 'export const enabled = (value, fallback) => value || fallback;',
    corrected: 'export const enabled = (value, fallback) => value ?? fallback;',
    primary: [
      'An absent flag uses the supplied default',
      ({ enabled }) => {
        assert.equal(enabled(undefined, true), true);
      },
    ],
    edge: [
      'An explicit false overrides a true default',
      ({ enabled }) => {
        assert.equal(enabled(false, true), false);
      },
    ],
  },
  {
    id: 'time-window',
    statement:
      'Select timestamps from the start of a time window up to its exclusive end.',
    first:
      'export const inWindow = (time, start, end) => time >= start && time <= end;',
    corrected:
      'export const inWindow = (time, start, end) => time >= start && time < end;',
    primary: [
      'The lower boundary and interior are included',
      ({ inWindow }) => {
        assert.equal(inWindow(100, 100, 200), true);
        assert.equal(inWindow(150, 100, 200), true);
      },
    ],
    edge: [
      'Adjacent windows do not both count the upper boundary',
      ({ inWindow }) => {
        assert.equal(inWindow(200, 100, 200), false);
        assert.equal(inWindow(200, 200, 300), true);
      },
    ],
  },
  {
    id: 'atomic-batch',
    statement: 'Append a batch of positive integers atomically.',
    first:
      'export function append(target, items) { for (const item of items) { if (!Number.isInteger(item) || item < 1) throw new Error("Invalid item"); target.push(item); } }',
    corrected:
      'export function append(target, items) { if (items.some(item => !Number.isInteger(item) || item < 1)) throw new Error("Invalid item"); target.push(...items); }',
    primary: [
      'A valid batch is appended in order',
      ({ append }) => {
        const target = [1];
        append(target, [2, 3]);
        assert.deepEqual(target, [1, 2, 3]);
      },
    ],
    edge: [
      'An invalid later item leaves the destination untouched',
      ({ append }) => {
        const target = [1];
        assert.throws(() => append(target, [2, 0]));
        assert.deepEqual(target, [1]);
      },
    ],
  },
  {
    id: 'asset-path',
    statement: 'Resolve relative paths within a POSIX asset directory.',
    first:
      'import { posix } from "node:path"; export const asset = (root, name) => posix.resolve(root, name);',
    corrected:
      'import { posix } from "node:path"; export function asset(root, name) { const base = posix.resolve(root); const path = posix.resolve(base, name); const relative = posix.relative(base, path); if (posix.isAbsolute(name) || relative === ".." || relative.startsWith("../")) throw new Error("Outside asset directory"); return path; }',
    primary: [
      'A nested relative path resolves inside the root',
      ({ asset }) => {
        assert.equal(
          asset('/app/assets', 'images/logo.svg'),
          '/app/assets/images/logo.svg',
        );
      },
    ],
    edge: [
      'Parent traversal and absolute paths are rejected',
      ({ asset }) => {
        assert.throws(() => asset('/app/assets', '../secrets.json'));
        assert.throws(() => asset('/app/assets', '/etc/hosts'));
      },
    ],
  },
  {
    id: 'webhook-retry',
    statement: 'Retry webhook deliveries only for HTTP 429 and 5xx responses.',
    first: 'export const retry = status => status >= 400;',
    corrected:
      'export const retry = status => status === 429 || (status >= 500 && status <= 599);',
    primary: [
      'Rate limits and temporary server failures can be retried',
      ({ retry }) => {
        assert.equal(retry(429), true);
        assert.equal(retry(503), true);
      },
    ],
    edge: [
      'Authentication and malformed request errors are not retried',
      ({ retry }) => {
        assert.equal(retry(401), false);
        assert.equal(retry(400), false);
      },
    ],
  },
  {
    id: 'log-redaction',
    statement: 'Remove token fields from structured logs at any object depth.',
    first: 'export const redact = ({ token, ...rest }) => rest;',
    corrected:
      'export function redact(value) { if (Array.isArray(value)) return value.map(redact); if (value === null || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "token").map(([key, nested]) => [key, redact(nested)])); }',
    primary: [
      'The top-level token is removed and other fields are preserved',
      ({ redact }) => {
        assert.deepEqual(redact({ token: 'fixture', event: 'login' }), {
          event: 'login',
        });
      },
    ],
    edge: [
      'Tokens nested in objects and arrays are removed',
      ({ redact }) => {
        assert.deepEqual(redact({ users: [{ name: 'A', token: 'fixture' }] }), {
          users: [{ name: 'A' }],
        });
      },
    ],
  },
  {
    id: 'cart-quantity',
    statement: 'Calculate cart totals in cents using each item’s quantity.',
    first:
      'export const total = items => items.reduce((sum, item) => sum + item.cents, 0);',
    corrected:
      'export const total = items => items.reduce((sum, item) => sum + item.cents * item.quantity, 0);',
    primary: [
      'One unit of each item adds their cent amounts',
      ({ total }) => {
        assert.equal(
          total([
            { cents: 299, quantity: 1 },
            { cents: 101, quantity: 1 },
          ]),
          400,
        );
      },
    ],
    edge: [
      'Multi-unit and zero-quantity rows use their quantity',
      ({ total }) => {
        assert.equal(
          total([
            { cents: 299, quantity: 3 },
            { cents: 101, quantity: 0 },
          ]),
          897,
        );
      },
    ],
  },
  {
    id: 'search-normalization',
    statement:
      'Search labels case-insensitively across equivalent Unicode representations.',
    first:
      'export const matches = (label, query) => label.toLowerCase().includes(query.toLowerCase());',
    corrected:
      'const normalize = text => text.normalize("NFC").toLowerCase(); export const matches = (label, query) => normalize(label).includes(normalize(query));',
    primary: [
      'ASCII case differences do not affect matching',
      ({ matches }) => {
        assert.equal(matches('Build Logs', 'LOGS'), true);
      },
    ],
    edge: [
      'A combining accent matches the equivalent precomposed label',
      ({ matches }) => {
        assert.equal(matches('Café', 'Cafe\u0301'), true);
      },
    ],
  },
];
