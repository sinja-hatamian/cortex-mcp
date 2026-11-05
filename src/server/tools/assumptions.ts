import type { McpServer } from '@modelcontextprotocol/server';
import {
  trackAssumptionInput,
  trackAssumptionOutput,
  updateAssumptionInput,
  updateAssumptionOutput,
} from '../../schemas/assumptions.js';
import { AssumptionNotFound } from '../../storage/repositories/assumptions.js';
import type { createRepositories } from '../../storage/repositories/index.js';
import { toolError, toolResult } from './results.js';

export function registerAssumptionTools(
  server: McpServer,
  getRepositories: () => ReturnType<typeof createRepositories>,
): void {
  server.registerTool(
    'cortex_track_assumption',
    {
      description:
        'Register an unverified assumption with optional caller-reported confidence.',
      inputSchema: trackAssumptionInput,
      outputSchema: trackAssumptionOutput,
    },
    ({ project_id, ...input }) => {
      try {
        const assumption = getRepositories().assumptions.create(
          project_id,
          input,
          {
            createProjectIfMissing: true,
          },
        );
        return toolResult({
          assumption_id: assumption.id,
          status: assumption.status,
        });
      } catch {
        return toolError('STORAGE_ERROR', 'Could not save the assumption.');
      }
    },
  );

  server.registerTool(
    'cortex_update_assumption',
    {
      description: 'Record a caller-reported assumption status and its reason.',
      inputSchema: updateAssumptionInput,
      outputSchema: updateAssumptionOutput,
    },
    ({ project_id, assumption_id, status, reason }) => {
      try {
        const assumption = getRepositories().assumptions.updateStatus(
          project_id,
          assumption_id,
          status,
          reason,
        );
        return toolResult({
          assumption_id: assumption.id,
          status: assumption.status,
          updated_at: assumption.updated_at,
        });
      } catch (error) {
        if (error instanceof AssumptionNotFound) {
          return toolError(
            'INVALID_REFERENCE',
            'Assumption was not found in the given project.',
          );
        }
        return toolError('STORAGE_ERROR', 'Could not update the assumption.');
      }
    },
  );
}
