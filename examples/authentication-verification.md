# Verify an authentication claim

Run the fixture from a source checkout after installing dependencies.

```sh
pnpm build
pnpm smoke:auth
```

The example connects over stdio with the official MCP client SDK and uses a temporary data directory. It submits example reports about an API. No API or credentials are needed.

1. Create a claim that protected routes deny unauthenticated requests. Add required criteria for integration coverage and denial responses.
2. Record the caller's report that the integration suite covered the routes. Review the claim. Expect `unverified` and `MISSING_REQUIRED_EVIDENCE` for the denial criterion.
3. Record the caller's claimed test output showing HTTP 401. Review again. Expect `criteria_satisfied_as_reported: true`, `status: "unverified"`, and `assurance: "reported_only"` under `strict-1`.
4. Track the assumption that middleware covers every protected route. Record that the caller refuted it after finding a route that bypasses the middleware.
5. Review the deployment decision against the claim and assumption. Expect `REFUTED_ASSUMPTION` and an advisory `blocked_recommendation`.
6. Reconnect and request project context. The assumption event, evidence, and saved reviews are available in the new session.

The fixture exercises all six product tools. The warning and recommendation are consequences of the recorded evidence, policy, and assumption status. The test fixture supplies those observations.
