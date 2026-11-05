# Cortex MCP

Cortex MCP aims to help AI agents make claims accountable to evidence. The project is designed to record verification criteria, evidence provenance, assumptions, and review findings locally.

The stdio server exposes one tool, `cortex_health`. Call it with `{}` to receive `ok` and confirm that the process is responding. Milestone 1 adds the internal storage layer. The health tool runs without opening a database. Evidence and verification tools are planned in the [project brief](CORTEX_MCP_CODEX_BRIEF_V2.md).

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

The protocol tests exercise the built CLI over stdio. The storage tests use temporary SQLite databases to check migrations, project isolation, atomic writes, and persistence across processes.

## License

[MIT](LICENSE)
