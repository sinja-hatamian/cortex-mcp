import type { McpServer } from '@modelcontextprotocol/server';
import { getContextInput, getContextOutput } from '../../schemas/context.js';
import type { createRepositories } from '../../storage/repositories/index.js';
import { toolError, toolResult } from './results.js';

export function registerContextTool(
  server: McpServer,
  getRepositories: () => ReturnType<typeof createRepositories>,
): void {
  server.registerTool(
    'cortex_get_context',
    {
      description:
        'Recover recent records for selected collections in one project. Review results are summaries.',
      inputSchema: getContextInput,
      outputSchema: getContextOutput,
    },
    ({ project_id, include, limit }) => {
      try {
        return toolResult(
          getRepositories().context.get(project_id, include, limit),
        );
      } catch {
        return toolError('STORAGE_ERROR', 'Could not read project context.');
      }
    },
  );
}
