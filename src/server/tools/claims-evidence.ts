import type { McpServer } from '@modelcontextprotocol/server';
import {
  addEvidenceInput,
  addEvidenceOutput,
  createClaimInput,
  createClaimOutput,
} from '../../schemas/claims-evidence.js';
import { isForeignKeyViolation } from '../../storage/db.js';
import type { createRepositories } from '../../storage/repositories/index.js';
import { toolError, toolResult } from './results.js';

export function registerClaimEvidenceTools(
  server: McpServer,
  getRepositories: () => ReturnType<typeof createRepositories>,
): void {
  server.registerTool(
    'cortex_create_claim',
    {
      description:
        'Register a claim and its verification criteria in a project.',
      inputSchema: createClaimInput,
      outputSchema: createClaimOutput,
    },
    ({ project_id, statement, criteria }) => {
      try {
        const claim = getRepositories().claims.create(
          project_id,
          statement,
          criteria,
          {
            createProjectIfMissing: true,
          },
        );
        return toolResult({
          claim_id: claim.id,
          criteria: claim.criteria.map(({ id, key }) => ({
            criterion_id: id,
            key,
          })),
          status: 'unverified',
        });
      } catch {
        return toolError('STORAGE_ERROR', 'Could not save the claim.');
      }
    },
  );

  server.registerTool(
    'cortex_add_evidence',
    {
      description:
        'Record evidence and its claimed provenance for an existing claim.',
      inputSchema: addEvidenceInput,
      outputSchema: addEvidenceOutput,
    },
    ({ project_id, ...input }) => {
      try {
        const evidence = getRepositories().evidence.add(project_id, input);
        return toolResult({
          evidence_id: evidence.id,
          provenance: {
            origin: evidence.origin,
            source_type: evidence.source_type,
            source_ref: evidence.source_ref,
            observed_at: evidence.observed_at,
            artifact_digest: evidence.artifact_digest,
            collector: evidence.collector,
            integrity_status: evidence.integrity_status,
          },
          assurance: 'unverified_origin',
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          return toolError(
            'INVALID_REFERENCE',
            'Claim or criterion was not found for the given project and claim.',
          );
        }
        return toolError('STORAGE_ERROR', 'Could not save the evidence.');
      }
    },
  );
}
