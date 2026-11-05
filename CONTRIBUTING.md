# Contributing to Cortex MCP

Use the Node.js version in `.node-version` and the pnpm version in `package.json`. Install from the lockfile and build before running protocol tests.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm smoke:auth
```

Keep pull requests focused and describe the behavior changed and the checks you ran. Changes to storage or MCP contracts should cover existing data, project scoping, and safe errors. Keep applied migrations intact and add a new version for schema changes.

The [release checklist](docs/release-checklist.md) covers the installed CLI smoke test and release gates. For security issues, see [SECURITY.md](SECURITY.md).
