import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import packageInfo from '../../package.json' with { type: 'json' };

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'cortex-mcp',
    version: packageInfo.version,
  });

  server.registerTool(
    'cortex_health',
    {
      description: 'Check that the Cortex MCP server is responding.',
      inputSchema: z.strictObject({}),
    },
    () => ({ content: [{ type: 'text', text: 'ok' }] }),
  );

  return server;
}
