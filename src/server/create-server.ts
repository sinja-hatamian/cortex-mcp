import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import packageInfo from '../../package.json' with { type: 'json' };
import { openDatabase } from '../storage/db.js';
import { createRepositories } from '../storage/repositories/index.js';
import { registerAssumptionTools } from './tools/assumptions.js';
import { registerClaimEvidenceTools } from './tools/claims-evidence.js';
import { registerContextTool } from './tools/context.js';
import { registerReviewTool } from './tools/review.js';

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

  let db: ReturnType<typeof openDatabase> | undefined;
  let repositories: ReturnType<typeof createRepositories> | undefined;
  let closed = false;
  const getRepositories = () => {
    if (closed) throw new Error('Cortex MCP session is closed');
    db ??= openDatabase();
    return (repositories ??= createRepositories(db));
  };
  registerClaimEvidenceTools(server, getRepositories);
  registerAssumptionTools(server, getRepositories);
  registerReviewTool(server, getRepositories);
  registerContextTool(server, getRepositories);
  server.server.onclose = () => {
    closed = true;
    db?.close();
    db = undefined;
  };

  return server;
}
