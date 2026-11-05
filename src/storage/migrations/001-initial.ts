// Keep applied migrations fixed so existing databases can be upgraded in order.
export const initialSchema = `
  CREATE TABLE projects (
    project_id TEXT PRIMARY KEY CHECK (length(project_id) > 0 AND length(CAST(project_id AS BLOB)) <= 128 AND project_id = trim(project_id)),
    policy TEXT NOT NULL DEFAULT 'strict' CHECK (policy IN ('strict', 'provisional')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE claims (
    project_id TEXT NOT NULL REFERENCES projects (project_id),
    id TEXT NOT NULL CHECK (length(id) = 36),
    statement TEXT NOT NULL CHECK (length(trim(statement)) > 0 AND length(CAST(statement AS BLOB)) <= 2000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id)
  ) STRICT;

  CREATE TABLE claim_criteria (
    project_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    id TEXT NOT NULL CHECK (length(id) = 36),
    key TEXT NOT NULL CHECK (length(key) > 0 AND length(CAST(key AS BLOB)) <= 128 AND key = trim(key)),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0 AND length(CAST(description AS BLOB)) <= 2000),
    required INTEGER NOT NULL CHECK (required IN (0, 1)),
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id),
    UNIQUE (project_id, claim_id, id),
    UNIQUE (project_id, claim_id, key),
    UNIQUE (project_id, claim_id, position),
    FOREIGN KEY (project_id, claim_id) REFERENCES claims (project_id, id)
  ) STRICT;

  CREATE TABLE evidence (
    project_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    id TEXT NOT NULL CHECK (length(id) = 36),
    criterion_id TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('agent_reported', 'user_attested', 'tool_output_recorded')),
    source_type TEXT NOT NULL CHECK (source_type IN ('test', 'build', 'log', 'document', 'manual_observation', 'other')),
    source_ref TEXT CHECK (length(CAST(source_ref AS BLOB)) <= 512),
    observed_at TEXT NOT NULL,
    relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'neutral')),
    content_summary TEXT NOT NULL CHECK (length(trim(content_summary)) > 0 AND length(CAST(content_summary AS BLOB)) <= 2000),
    artifact_digest TEXT CHECK (length(artifact_digest) = 64 AND length(CAST(artifact_digest AS BLOB)) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*'),
    collector TEXT CHECK (length(CAST(collector AS BLOB)) <= 128),
    integrity_status TEXT GENERATED ALWAYS AS (
      CASE WHEN artifact_digest IS NULL THEN 'unverified' ELSE 'digest_recorded' END
    ) STORED,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id, claim_id) REFERENCES claims (project_id, id),
    FOREIGN KEY (project_id, claim_id, criterion_id) REFERENCES claim_criteria (project_id, claim_id, id)
  ) STRICT;

  CREATE TABLE assumptions (
    project_id TEXT NOT NULL REFERENCES projects (project_id),
    id TEXT NOT NULL CHECK (length(id) = 36),
    statement TEXT NOT NULL CHECK (length(trim(statement)) > 0 AND length(CAST(statement AS BLOB)) <= 2000),
    context TEXT CHECK (length(CAST(context AS BLOB)) <= 2000),
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'supported', 'refuted', 'inconclusive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id)
  ) STRICT;

  CREATE TABLE assumption_events (
    project_id TEXT NOT NULL,
    assumption_id TEXT NOT NULL,
    id TEXT NOT NULL CHECK (length(id) = 36),
    position INTEGER NOT NULL CHECK (position > 0),
    previous_status TEXT NOT NULL CHECK (previous_status IN ('unverified', 'supported', 'refuted', 'inconclusive')),
    status TEXT NOT NULL CHECK (status IN ('unverified', 'supported', 'refuted', 'inconclusive')),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0 AND length(CAST(reason AS BLOB)) <= 2000),
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id),
    UNIQUE (project_id, assumption_id, position),
    FOREIGN KEY (project_id, assumption_id) REFERENCES assumptions (project_id, id)
  ) STRICT;

  CREATE TABLE reviews (
    project_id TEXT NOT NULL REFERENCES projects (project_id),
    id TEXT NOT NULL CHECK (length(id) = 36),
    target_type TEXT NOT NULL,
    claim_id TEXT,
    decision TEXT CHECK (length(trim(decision)) > 0 AND length(CAST(decision AS BLOB)) <= 2000),
    status TEXT NOT NULL,
    policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) > 0 AND length(CAST(policy_version AS BLOB)) <= 128),
    claim_evaluations TEXT NOT NULL CHECK (json_valid(claim_evaluations) AND json_type(claim_evaluations) = 'array'),
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id, claim_id) REFERENCES claims (project_id, id),
    CHECK (
      (target_type = 'claim' AND claim_id IS NOT NULL AND decision IS NULL
        AND status IN ('unverified', 'verified', 'contradicted'))
      OR
      (target_type = 'decision' AND claim_id IS NULL AND decision IS NOT NULL
        AND status IN ('pass_with_caveats', 'warning', 'blocked_recommendation'))
    )
  ) STRICT;

  CREATE TABLE review_targets (
    project_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    claim_id TEXT,
    assumption_id TEXT,
    PRIMARY KEY (project_id, review_id, position),
    UNIQUE (project_id, review_id, claim_id),
    UNIQUE (project_id, review_id, assumption_id),
    CHECK ((claim_id IS NULL) <> (assumption_id IS NULL)),
    FOREIGN KEY (project_id, review_id) REFERENCES reviews (project_id, id),
    FOREIGN KEY (project_id, claim_id) REFERENCES claims (project_id, id),
    FOREIGN KEY (project_id, assumption_id) REFERENCES assumptions (project_id, id)
  ) STRICT;

  CREATE TABLE review_findings (
    project_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    rule_id TEXT NOT NULL CHECK (length(trim(rule_id)) > 0 AND length(CAST(rule_id AS BLOB)) <= 128),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    record_ids TEXT NOT NULL CHECK (json_valid(record_ids) AND json_type(record_ids) = 'array'),
    message TEXT NOT NULL CHECK (length(trim(message)) > 0 AND length(CAST(message AS BLOB)) <= 2000),
    PRIMARY KEY (project_id, review_id, position),
    FOREIGN KEY (project_id, review_id) REFERENCES reviews (project_id, id)
  ) STRICT;

  CREATE INDEX claims_by_project_created ON claims (project_id, created_at, id);
  CREATE INDEX criteria_by_project_created ON claim_criteria (project_id, created_at, id);
  CREATE INDEX evidence_by_project_created ON evidence (project_id, created_at, id);
  CREATE INDEX evidence_by_criterion ON evidence (project_id, claim_id, criterion_id);
  CREATE INDEX assumptions_by_project_created ON assumptions (project_id, created_at, id);
  CREATE INDEX assumption_events_by_project_created ON assumption_events (project_id, created_at, id);
  CREATE INDEX reviews_by_project_created ON reviews (project_id, created_at, id);
  CREATE INDEX reviews_by_claim ON reviews (project_id, claim_id);
  CREATE INDEX review_targets_by_claim ON review_targets (project_id, claim_id);
  CREATE INDEX review_targets_by_assumption ON review_targets (project_id, assumption_id);
`;
