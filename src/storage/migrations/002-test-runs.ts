export const testRunSchema = `
  CREATE TABLE test_runs (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL CHECK (length(id) = 36),
    claim_id TEXT NOT NULL,
    criterion_id TEXT NOT NULL,
    revision TEXT NOT NULL CHECK (length(revision) IN (40, 64) AND revision NOT GLOB '*[^0-9a-f]*'),
    node_version TEXT NOT NULL,
    test_paths TEXT NOT NULL CHECK (json_valid(test_paths) AND json_type(test_paths) = 'array' AND json_array_length(test_paths) BETWEEN 1 AND 8),
    exit_code INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id, claim_id, criterion_id) REFERENCES claim_criteria (project_id, claim_id, id)
  ) STRICT;
  CREATE INDEX test_runs_by_project_created ON test_runs (project_id, created_at DESC, id DESC);
`;
