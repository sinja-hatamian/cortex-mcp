# Cortex MCP

Cortex MCP helps AI agents make claims accountable to evidence. It records verification criteria, evidence provenance, assumptions, and deterministic review findings locally.

The stdio server lets clients register claims, record evidence, track assumptions, review claims or proposed decisions, and recover project context. Call `cortex_health` with `{}` to check that the server is responding. The health tool runs without opening a database. See the [project brief](CORTEX_MCP_CODEX_BRIEF_V2.md) for the full roadmap.

## Build locally

Use the Node.js version in `.node-version` and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
```

The build produces `dist/cli.js`, which an MCP client launches with `node` over stdio. Dependency installation uses the npm registry. After installation, Cortex runs locally without network access, a cloud account, or an API key. Stdout carries MCP messages.

## Connect a client

For a client that uses an `mcpServers` config, set the command and the path to the compiled entry point. Use an absolute path to Node.js if the client does not inherit your shell's `PATH`.

```json
{
  "mcpServers": {
    "cortex-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/cortex-mcp/dist/cli.js"]
    }
  }
}
```

From the project directory, the official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) can launch the CLI, list its tools, and call `cortex_health`.

```sh
npx --yes @modelcontextprotocol/inspector@2.14.0 --cli node dist/cli.js --method tools/list
npx --yes @modelcontextprotocol/inspector@2.14.0 --cli node dist/cli.js --method tools/call --tool-name cortex_health
```

## Register claims and evidence

Call `cortex_create_claim` with an explicit project ID, a statement, and 1 to 32 criteria. Criterion keys must be unique within the claim, and at least one criterion must be required.

```json
{
  "project_id": "example-api",
  "statement": "Protected routes reject unauthenticated requests",
  "criteria": [
    {
      "key": "negative-test",
      "description": "Unauthenticated requests receive a denial response",
      "required": true
    }
  ]
}
```

The tool returns `claim_id`, a `criteria` array of `key` and `criterion_id` pairs, and `status: "unverified"`. A new project is created with the strict policy when its first claim is saved.

Call `cortex_add_evidence` with the same project ID. Replace the example UUIDs with the IDs returned by `cortex_create_claim`. Omit `criterion_id` to attach the record to the claim as a whole.

```json
{
  "project_id": "example-api",
  "claim_id": "20ca80ac-856d-419c-acfb-09861cbba83f",
  "criterion_id": "f54c6a36-8a65-4b77-a2d3-7f7e205dd5d8",
  "content_summary": "Integration test observed a 401 response",
  "relation": "supports",
  "origin": "agent_reported",
  "source_type": "test",
  "source_ref": "pnpm test:integration",
  "observed_at": "2026-11-05T00:00:00Z"
}
```

`relation` accepts `supports`, `contradicts`, or `neutral`. `origin` defaults to `agent_reported` and also accepts `user_attested` or `tool_output_recorded`. `source_type` accepts `test`, `build`, `log`, `document`, `manual_observation`, or `other`. `source_ref`, `collector`, and a 64-character hexadecimal SHA-256 `artifact_digest` are optional.

The tool returns `evidence_id`, recorded `provenance`, and `assurance: "unverified_origin"`. A supplied digest sets `integrity_status` to `digest_recorded`. The caller supplies both the origin and the digest, so neither establishes independent collection. To evaluate the claim after registering evidence, call `cortex_review`. Missing and out-of-scope claim or criterion IDs return the same `INVALID_REFERENCE` error.

## Review a claim or decision

Call `cortex_review` with `target_type: "claim"` and the claim ID as `target_id`.

```json
{
  "project_id": "example-api",
  "target_type": "claim",
  "target_id": "20ca80ac-856d-419c-acfb-09861cbba83f"
}
```

For a decision, use `target_type: "decision"`, a `decision` statement, and at least one ID in `claim_ids` or `assumption_ids`. Each list accepts up to 16 unique IDs. The tool evaluates the referenced records in the given project and saves a new snapshot. The response includes `review_id`, `policy_version`, `status`, `claim_evaluations`, and ordered `findings`.

New projects use `strict-1`. This policy treats caller-supplied evidence as reported and leaves claims unverified. Projects provisioned with the provisional policy use `provisional-1`. It admits `user_attested` and `tool_output_recorded` records for provisional results. A verified claim requires admissible support linked to every required criterion. Admissible evidence linked to a required criterion takes precedence when it contradicts that criterion. Both `verified` and `contradicted` carry `assurance: "provisional"` under that policy.

`criteria_satisfied_as_reported` tracks positive coverage separately. It is true when every required criterion has a linked supporting report, including when other records contradict that support. Neutral or unlinked records provide no criterion coverage. Review uses the relation recorded by the caller and the project policy.

Each claim evaluation lists its required criteria in `criterion_evaluations`, with an `outcome`, `criterion_id`, and `key`. Outcomes appear in the order below, with ties sorted by key.

| Outcome               | What Cortex recorded                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `conflicting_reports` | Both supporting and contradicting evidence link to the criterion.                           |
| `reported_failure`    | Contradicting evidence links to the criterion and supporting evidence is absent.            |
| `missing_evidence`    | No supporting or contradicting evidence links to the criterion.                             |
| `unverified_source`   | Supporting evidence links to the criterion, and the policy admits none of it.               |
| `supported`           | The policy admits supporting evidence and no contradicting evidence links to the criterion. |

These outcomes explain evidence coverage and policy eligibility. A reported failure reflects the recorded relation, and support admitted by the provisional policy carries provisional assurance. A review saved before this field was introduced retains its original snapshot.

Decision reviews are advisory and cover the referenced records. A contradicted claim or a refuted assumption yields `blocked_recommendation`. Other warnings yield `warning`. A review with no such findings yields `pass_with_caveats`.

| Rule                        | When it applies                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MISSING_REQUIRED_EVIDENCE` | A required criterion lacks linked supporting evidence, or the claim has no required criteria.                                                     |
| `UNVERIFIED_CLAIM`          | The claim evaluates to `unverified` under the current policy.                                                                                     |
| `CONTRADICTORY_EVIDENCE`    | Evidence is recorded as contradicting. An admissible contradiction linked to a required criterion is an error. Other contradictions are warnings. |
| `REFUTED_ASSUMPTION`        | A referenced assumption is recorded as refuted.                                                                                                   |
| `UNRESOLVED_ASSUMPTION`     | A referenced assumption is recorded as unverified or inconclusive.                                                                                |
| `REPORTED_ONLY_EVIDENCE`    | Supporting or contradicting records are outside the policy's admissible origins.                                                                  |
| `INVALID_REFERENCE`         | A project, claim, or assumption reference is missing or out of scope. The tool returns an error before saving a review.                           |

Findings sort by severity, rule ID, and record IDs. Grouped evidence findings report the total and include up to three matching evidence IDs. Later evidence or assumption updates leave saved reviews intact.

## Track assumptions and recover context

Call `cortex_track_assumption` with `project_id` and `statement`. You can also supply `context` and a caller-reported `confidence` between 0 and 1. The tool returns `assumption_id` and initial status `unverified`. The first assumption can create a project under the strict policy.

Call `cortex_update_assumption` with `project_id`, `assumption_id`, `status`, and a `reason`. Statuses are `unverified`, `supported`, `refuted`, and `inconclusive`. Each update records the previous and new status, reason, and timestamp. The result includes the assumption ID, status, and `updated_at`. A missing or out-of-scope assumption returns `INVALID_REFERENCE`. Statuses record the caller's assessment and can be referenced in decision reviews.

Use `cortex_get_context` to recover selected collections after reconnecting.

```json
{
  "project_id": "example-api",
  "include": [
    "claims",
    "assumptions",
    "assumption_events",
    "evidence",
    "reviews"
  ],
  "limit": 5
}
```

The result contains the project ID and only the requested collections. The limit is 1 to 20 records per collection and defaults to 20. Records are sorted by creation time, newest first, with descending record IDs breaking ties. For events on one assumption, `position` gives the order in which updates were recorded.

Claim entries include criterion IDs, keys, and required flags. Evidence includes claimed provenance and `assurance: "unverified_origin"`. Review summaries include the target, status, policy version, and creation time. A project with no matching records returns empty arrays for the requested collections.

## Collect a local test run

The experimental collector requires Git and an existing claim and criterion. Run it from the checkout with the same `CORTEX_DATA_DIR` as the MCP server. Pass one to eight distinct, tracked test files as paths relative to the Git root.

```sh
node /absolute/path/to/cortex-mcp/dist/cli.js collect-test example-api CLAIM_ID CRITERION_ID -- test/auth.test.mjs
```

Cortex runs the selected files with Node's built-in test runner. It checks for a clean Git working tree and the same `HEAD` before and after execution. It prints a JSON receipt to stdout and directs test output to stderr. Exit codes are `0` for a saved run that exited successfully, `1` for a saved run with a nonzero test exit, and `2` for a collection error. The receipt retains the test runner's original exit code. A launch error or a run that times out after two minutes yields no receipt.

Request `"include": ["test_runs"]` with `cortex_get_context` to recover receipts. Each contains the claim and criterion IDs, Git revision, Node version, selected files, observed exit code, and timestamp. The collector executes local test code with the user's permissions. A clean Git check observes the working tree at two points, and ignored files or local dependencies can still affect execution. Reviews evaluate separately submitted evidence under the project policy.

## Local storage

The storage layer uses Node's built-in, synchronous `node:sqlite` driver. It creates and migrates `cortex.sqlite3` when the internal database is opened. [Node.js SQLite documentation](https://nodejs.org/download/release/latest-lithium/docs/api/sqlite.html)

| Platform                     | Default data directory                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| macOS                        | `~/Library/Application Support/Cortex MCP`                                                 |
| Windows                      | `%LOCALAPPDATA%\Cortex MCP`, with `%USERPROFILE%\AppData\Local\Cortex MCP` as the fallback |
| Linux and other Unix systems | `$XDG_DATA_HOME/cortex-mcp`, with `~/.local/share/cortex-mcp` as the fallback              |

Set `CORTEX_DATA_DIR` to an absolute directory path to override the default. On POSIX systems, Cortex requests owner-only permissions for directories and database files it creates. Existing permissions depend on the filesystem and OS.

Project IDs provide logical isolation within a database. They do not authenticate callers. Evidence provenance records the claimed origin, and a recorded digest captures the supplied value. Reviews store their findings and claim evaluations as snapshots.

To remove local Cortex data, close every client using the database. Back up `cortex.sqlite3` and any associated SQLite sidecar files if you want to keep a copy, then delete those files from the configured directory. If you use a shared data directory, leave its other files in place.

## Example and limitations

Run the [authentication verification example](examples/authentication-verification.md) to see a missing-evidence warning, caller-reported coverage, an advisory blocked recommendation, and recovery after reconnecting.

Cortex evaluates explicit relationships and caller-reported observations under the project policy. A client can fabricate or omit reports, and verification under a policy carries the assurance shown in the result. Local test receipts record an observed process exit. Their integrity depends on the local environment and SQLite file access. See [security and trust](SECURITY.md) for reporting and data handling.

## Run the checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm smoke:auth
pnpm smoke:package
pnpm benchmark
```

The protocol tests launch the built CLI over stdio and check registration, reviews, assumption updates, context recovery, and safe input errors. Unit tests exercise policy and rule ordering. Storage tests use temporary SQLite databases to check migrations, bounded retrieval, project isolation, atomic writes, and persistence across processes.

The package smoke test installs a local tarball in a fresh temporary project and runs the example with runtime network access denied. The benchmark reports rule outcomes and timing on synthetic fixtures. See the [contribution guide](CONTRIBUTING.md) and [release checklist](docs/release-checklist.md).

## License

[MIT](LICENSE)
