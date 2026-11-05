# Cortex MCP

Cortex MCP aims to help AI agents make claims accountable to evidence. The project is designed to record verification criteria, evidence provenance, assumptions, and review findings locally.

Milestone 0 provides a stdio MCP server with one tool, `cortex_health`. Call it with `{}` to receive `ok` and confirm that the process is responding. The foundation is stateless. Evidence and verification tools are planned in the [project brief](CORTEX_MCP_CODEX_BRIEF_V2.md).

For the storage milestone, the planned driver is Node's built-in `node:sqlite`. It avoids a separate native addon installation. Its synchronous API and release-candidate status will be evaluated when persistence is implemented. [Node.js SQLite documentation](https://nodejs.org/download/release/latest-lithium/docs/api/sqlite.html)

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

## Run the checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

The protocol tests launch the built CLI and exercise initialization, discovery, a tool call, invalid input, and clean stdio shutdown.

## License

[MIT](LICENSE)
