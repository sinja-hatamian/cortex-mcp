import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export async function withClient<T>(
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
