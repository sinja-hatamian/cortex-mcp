# Experimental release checklist

- [ ] Confirm the target version and the npm package name. The local candidate uses the private `cortex-mcp-foundation` package and `cortex-mcp` command.
- [ ] Run a frozen-lockfile install, formatting, lint, type checking, build, and tests on the candidate commit. Check CI for Linux, macOS, and Windows and record any coverage gaps.
- [ ] Run `pnpm smoke:package`. It packs into a temporary directory, installs the tarball in a fresh project, and starts the installed CLI with runtime network access denied. [Node.js Permission Model](https://nodejs.org/download/release/latest-lithium/docs/api/permissions.html)
- [ ] Connect MCP Inspector over stdio and confirm discovery of the six product tools and the health tool.
- [ ] Run the [authentication fixture](../examples/authentication-verification.md). Confirm strict provenance, the advisory blocked recommendation, and context recovery after reconnecting.
- [ ] Run `pnpm benchmark` and review the synthetic rule outcomes. Track real-agent evaluation separately.
- [ ] Run `pnpm audit --prod --audit-level high` and review dependency advisories, [security and trust limits](../SECURITY.md), user-facing installation instructions, and release notes.
- [ ] Obtain explicit approval for npm publication, Git tags, or a GitHub release before taking those actions.
