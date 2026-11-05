# Cortex MCP

Cortex MCP aims to help AI agents make claims accountable to evidence. The project is designed to record verification criteria, evidence provenance, assumptions, and review findings locally.

The stdio server lets clients register claims and record evidence. Call `cortex_health` with `{}` to check that the server is responding. The health tool runs without opening a database. Review and verification are planned in the [project brief](CORTEX_MCP_CODEX_BRIEF_V2.md).

## Build locally

Use the Node.js version in `.node-version` and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
```

The build produces `dist/cli.js`, which an MCP client launches with `node` over stdio. Cortex runs locally without a cloud account or API key. Stdout carries MCP messages.

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

Call `cortex_create_claim` with an explicit project ID, a statement, and 1 to 32 criteria. Criterion keys must be unique within the claim.

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

The tool returns `evidence_id`, recorded `provenance`, and `assurance: "unverified_origin"`. A supplied digest sets `integrity_status` to `digest_recorded`. The caller supplies both the origin and the digest, so neither establishes independent collection. Evidence registration leaves the claim unverified. Missing and out-of-scope claim or criterion IDs return the same `INVALID_REFERENCE` error.

## Local storage

The storage layer uses Node's built-in, synchronous `node:sqlite` driver. It creates and migrates `cortex.sqlite3` when the internal database is opened. [Node.js SQLite documentation](https://nodejs.org/download/release/latest-lithium/docs/api/sqlite.html)

| Platform                     | Default data directory                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| macOS                        | `~/Library/Application Support/Cortex MCP`                                                 |
| Windows                      | `%LOCALAPPDATA%\Cortex MCP`, with `%USERPROFILE%\AppData\Local\Cortex MCP` as the fallback |
| Linux and other Unix systems | `$XDG_DATA_HOME/cortex-mcp`, with `~/.local/share/cortex-mcp` as the fallback              |

Set `CORTEX_DATA_DIR` to an absolute directory path to override the default. On POSIX systems, Cortex requests owner-only permissions for directories and database files it creates. Existing permissions depend on the filesystem and OS.

Project IDs provide logical isolation within a database. They do not authenticate callers. Evidence provenance records the claimed origin, and a recorded digest captures the supplied value. Reviews store their findings and claim evaluations as snapshots.

## Run the checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

The protocol tests launch the built CLI over stdio and check tool discovery, claim creation, evidence registration, and safe input errors. The storage tests use temporary SQLite databases to check migrations, project isolation, atomic writes, and persistence across processes.

## License

[MIT](LICENSE)
