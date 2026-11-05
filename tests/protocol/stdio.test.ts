import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, test } from 'vitest';
import packageInfo from '../../package.json' with { type: 'json' };

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

test('an MCP client discovers and calls the health tool over stdio', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cortex-smoke-'));
  const client = new Client({ name: 'cortex-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    cwd,
  });

  try {
    await client.connect(transport);
    expect(client.getServerVersion()).toEqual({
      name: 'cortex-mcp',
      version: packageInfo.version,
    });

    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(['cortex_health']);
    const health = await client.callTool({
      name: 'cortex_health',
      arguments: {},
    });
    expect(health.isError).not.toBe(true);
    expect(health.content).toEqual([{ type: 'text', text: 'ok' }]);

    const invalid = await client.callTool({
      name: 'cortex_health',
      arguments: { unexpected: true },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await transport.close();
    expect(await readdir(cwd)).toEqual([]);
    await rmdir(cwd);
  }
});

test('stdout carries only MCP responses and stdin EOF ends the CLI', async () => {
  const child = spawn(process.execPath, [cli], { timeout: 4_000 });
  const closed = once(child, 'close');
  const stdout = createInterface({ input: child.stdout });
  const lines = stdout[Symbol.asyncIterator]();
  const send = (message: object) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const readResponse = async (): Promise<unknown> => {
    const line = await lines.next();
    if (line.done) throw new Error('CLI closed stdout before replying');
    return JSON.parse(line.value);
  };

  try {
    // Exercise the initialize handshake used by existing MCP hosts.
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'cortex-wire-test', version: '1.0.0' },
      },
    });
    expect(await readResponse()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'cortex-mcp' },
      },
    });

    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    expect(await readResponse()).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [{ name: 'cortex_health' }] },
    });

    send({
      id: 3,
      method: 'tools/call',
      params: { name: 'cortex_health', arguments: {} },
    });
    expect(await readResponse()).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'ok' }] },
    });

    child.stdin.end();
    expect((await lines.next()).done).toBe(true);
    expect(await closed).toEqual([0, null]);
  } finally {
    stdout.close();
    child.kill();
    await closed;
  }
});
