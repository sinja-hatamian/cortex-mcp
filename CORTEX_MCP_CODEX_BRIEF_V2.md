# Cortex MCP — Codex Project Brief (v2)

> **Document version:** 2.0 — 2026-11-05  
> **Project:** Cortex MCP  
> **Status:** Design approved for incremental implementation; not yet implemented  
> **Target first release:** `v0.1.0` (experimental)  
> **License:** MIT  
> **Audience:** Codex and open-source contributors  
> **Primary language:** English for source, documentation, API names, and tests

---

## 0. Instructions to Codex — READ FIRST

This document is the **source of truth** for the planned project. Do not treat proposed capabilities as already implemented.

**Mandatory execution protocol:**

1. Inspect the repository and this entire brief before proposing changes.
2. Work on **one explicitly authorized milestone only**.
3. Before editing files, present a concise implementation plan, affected files, risks, and acceptance tests. **Wait for approval.**
4. After approval, implement only the approved milestone. Do not silently implement future milestones.
5. Run the relevant tests, type checks, lint checks, and builds; report actual results, not assumptions.
6. List changed files, design deviations, limitations, and next steps.
7. **Stop after the authorized milestone.** Do not commit, push, publish, or create releases without explicit authorization.
8. If a requirement is ambiguous or infeasible, explain the tradeoff and ask before changing the specification.
9. Do not install an external LLM, hosted service, analytics, telemetry, or cloud dependency.
10. Never represent unverified agent-provided statements as independently validated facts.

**First action requested when this brief is handed to Codex:** inspect the repository and **plan Milestone 0 only; do not write code yet**.

---

## 1. Vision and problem statement

### Mission

**Cortex is an open-source, local-first Evidence & Verification Layer for AI Agents, exposed through the Model Context Protocol (MCP).**

Its purpose is not to make an agent “think harder” or read hidden chain-of-thought. Its purpose is to make consequential agent claims and decisions **inspectable against explicitly recorded evidence, provenance, and verification criteria**.

**Tagline:** *Make agent claims accountable to evidence.*

### Why this exists

Even capable agents may:
- declare work complete without checking every acceptance criterion;
- mistake a tool's success message for proof of the intended outcome;
- reuse a rejected assumption;
- confuse a self-reported observation with independently collected evidence;
- overlook contradictory evidence;
- lose important verification state when context is truncated.

Cortex should help answer:

> **What evidence justifies this claim, what has actually been checked, and what remains unknown?**

### Important limits

- Cortex is **not** an LLM, evaluator of private reasoning, agent framework, autonomous supervisor, or general-purpose truth oracle.
- It cannot observe arbitrary agent activity through MCP alone.
- A client must invoke Cortex tools; MCP by itself does not guarantee invocation or allow Cortex to block actions.
- Without independent provenance, agent-submitted evidence is **reported evidence**, not verified evidence.
- `verified` means *the defined verification policy is satisfied by admissible evidence*, **not** that the claim is universally true.
- The goal is measurable reliability improvement, not an unproven claim of preventing hallucinations.

### Audience

Any MCP-compatible AI agent, with **coding agents as the first test domain**. Keep the core domain-neutral so research and data-analysis agents can use it later.

---

## 2. Product principles

1. **Evidence first:** verification state and provenance matter more than free-text “reasoning logs.”
2. **Local first:** no account, server, remote API, or API key.
3. **Deterministic core:** rule-based checks, reproducible outputs, no model-to-model judgment in the MVP.
4. **Honest status:** distinguish unverified, verified-under-policy, and contradicted.
5. **No false authority:** user/agent-submitted observations are not automatically trustworthy.
6. **Domain-neutral core:** claims, criteria, evidence, decisions, reviews, projects.
7. **Coding-first examples:** tests, builds, route checks, CI output.
8. **Project isolation:** all data operations are scoped and checked.
9. **Opt-in, advisory:** no implicit file scans, shell commands, network calls, or agent interruption.
10. **Small outputs:** concise, structured MCP responses.
11. **Explainability:** every finding has a deterministic rule ID and referenced records.
12. **Testability:** benchmark value before adding sophisticated features.

---

## 3. Technical stack and decisions

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | Prefer strong contracts and maintainable core |
| Runtime | Current supported Node.js LTS | Verify exact supported version at implementation |
| MCP | Official TypeScript MCP SDK | Verify current API before coding |
| Transport | `stdio` | No HTTP server in MVP |
| Validation | Zod | Parse all MCP tool input |
| Database | SQLite | Embedded, transactional, local |
| SQLite driver | Choose and justify at Milestone 0 | Consider portability and install friction |
| Testing | Vitest | Unit, DB, protocol smoke, end-to-end scenarios |
| Package management | pnpm | Commit lockfile |
| Quality | ESLint + Prettier + `tsc --noEmit` | CI enforced |
| Distribution | npm package with CLI binary | Check package name availability |
| CI | GitHub Actions | Public repo |
| License | MIT | Include LICENSE |
| External AI | None | No embeddings or remote inference in MVP |

**Why TypeScript rather than Python:** the MVP is a protocol, structured-data, storage, and deterministic verification system, not an ML workload. Python may be introduced later for optional scientific/ML adapters if justified. Do not add a Python service speculatively.

**No Docker, Redis, PostgreSQL, FastAPI, dashboards, accounts, or cloud sync in v0.1.0.**

---

## 4. Revised MVP scope: verification over memory

The original idea emphasized assumption tracking. That remains useful, but **verification is now the product's center**.

### Core MVP entities

1. **Project** — isolation boundary, identified by `project_id`.
2. **Claim** — a statement the agent wants to justify (e.g. “All protected routes enforce authorization”).
3. **Criterion** — an explicit condition that must be satisfied to consider a claim verified.
4. **Evidence** — a recorded observation, artifact reference, or test result, including provenance.
5. **Assumption** — a working hypothesis with lifecycle status; may support a decision but is not proof.
6. **Decision** — an intended action or conclusion with references to relevant claims/assumptions.
7. **Review** — immutable snapshot of deterministic findings for a decision or claim.

### MVP features (must implement)

- Claim creation with one or more explicit verification criteria.
- Evidence registration with source/provenance classification and relation to a claim or criterion.
- Assumption registration and lifecycle updates.
- Rule-based claim and decision review with transparent findings.
- Project-scoped retrieval of claims, assumptions, evidence, and recent reviews.
- SQLite persistence across sessions.
- A minimal MCP CLI using `stdio`.
- Unit/integration tests and one realistic coding-agent example.
- Documentation that makes evidence trust limitations explicit.

### Defer to later releases

- semantic contradiction detection;
- automatic reading of arbitrary files/logs;
- independently executing tests or commands;
- automatic verification of arbitrary evidence URLs;
- persistent mistake/lesson retrieval and semantic search;
- hooks for specific agents;
- multi-agent shared state;
- dashboards, hosted services, vector DB, embeddings, LLM calls;
- automated intervention or blocking;
- dynamic plugin/adapter framework.

**Critical MVP design choice:** Do not label a claim `verified` merely because the agent says “test passed.” The MVP should default such evidence to **reported**, and require explicitly designated admissible verification records and criteria for a verified result. Because independently collected evidence is out of scope for the first iteration, **the system must clearly indicate the limits of any agent-supplied verification**.

---

## 5. Verification semantics and trust model

### Claim evaluation states

- `unverified`: criteria missing, incomplete, or supported only by inadmissible evidence.
- `verified`: all mandatory criteria have admissible positive evidence under a declared policy, and no unresolved admissible contradiction exists.
- `contradicted`: at least one admissible contradiction to a mandatory criterion exists.
- Optional `not_applicable` is **not** part of v0.1.0; do not silently add it.

**Evaluation precedence:** `contradicted` > `unverified` > `verified`.

### Provenance classification

Evidence must record:
- `origin`: `agent_reported | user_attested | tool_output_recorded`
- `source_type`: `test | build | log | document | manual_observation | other`
- `source_ref`: bounded string reference (e.g. command label, test file, artifact path), optional
- `observed_at`: timestamp
- `relation`: `supports | contradicts | neutral`
- `criterion_id`: optional, but needed to satisfy a specific criterion
- `content_summary`: bounded text
- `artifact_digest`: optional SHA-256 digest if provided
- `collector`: optional source identifier
- `integrity_status`: `unverified | digest_recorded` (a supplied digest is **not** proof of independent collection)

**Do not call evidence “independently verified” solely because `origin=tool_output_recorded`.** In v0.1.0, all evidence enters through an MCP call and can be spoofed by its caller. Record the *claimed origin* and disclose that it is not authenticated. The review engine may issue a `reported_only` outcome or caution instead of treating these records as high-assurance proof.

### MVP policy

Adopt a conservative policy:
- `reported_only` evidence may support **review notes** but cannot by itself produce an unqualified `verified` status.
- A project can define a **provisional evaluation policy** that accepts `user_attested` or `tool_output_recorded` records for `verified` **with an explicit `assurance: "provisional"` field**.
- Default policy is `strict`: with no trusted collector available, claim status remains `unverified` even if criteria appear satisfied; report `criteria_satisfied_as_reported: true` separately.
- **Do not build a trusted collector in MVP.** A future adapter/hook can make high-assurance verification possible.

This avoids the logical trap of a system certifying its own untrusted inputs.

### Decision review states

- `pass_with_caveats`: no known conflict, but report scope/assurance limits;
- `warning`: unsupported criteria, unresolved assumptions, or reported-only evidence;
- `blocked_recommendation`: refuted assumption or admissible contradiction (advisory only).

No actual agent execution is blocked.

---

## 6. Proposed MCP tool surface (v0.1.0)

**Tool count is not a product goal.** Prefer a small coherent API. The revised verification-centered MVP requires the following **six tools**; do not force the old five-tool design at the expense of claim verification.

| Tool | Purpose |
|---|---|
| `cortex_create_claim` | Register claim + required criteria |
| `cortex_add_evidence` | Record evidence and its claimed provenance/relation |
| `cortex_track_assumption` | Register assumption |
| `cortex_update_assumption` | Update assumption lifecycle with reason |
| `cortex_review` | Review a claim or a proposed decision |
| `cortex_get_context` | Retrieve scoped, bounded context |

### 6.1 `cortex_create_claim`

Input:
```json
{
  "project_id": "example-api",
  "statement": "Protected routes reject unauthenticated requests",
  "criteria": [
    {"key": "route-test", "description": "Integration test covers protected routes", "required": true},
    {"key": "negative-test", "description": "Unauthenticated requests receive 401 or an expected denial", "required": true}
  ]
}
```
Output: generated `claim_id`, criterion IDs, initial `unverified` status.

Rules: require at least one criterion; unique criterion keys per claim; bounded lengths and count; no implicit claims from arbitrary free text.

### 6.2 `cortex_add_evidence`

Input:
```json
{
  "project_id": "example-api",
  "claim_id": "claim-id",
  "criterion_id": "criterion-id",
  "content_summary": "Auth integration tests passed: 12 tests",
  "relation": "supports",
  "origin": "agent_reported",
  "source_type": "test",
  "source_ref": "pnpm test:integration",
  "observed_at": "2026-11-05T00:00:00Z"
}
```
Output: evidence ID, recorded provenance, `assurance: "unverified_origin"`.

Rules: criterion belongs to claim; project isolation; no secret-bearing raw stdout required; no automatic trust escalation.

### 6.3 `cortex_track_assumption`

Input:
```json
{
  "project_id": "example-api",
  "statement": "The route group already enforces authentication",
  "context": "Investigating API access",
  "confidence": 0.6
}
```
Output: assumption ID and initial `unverified` status. Confidence is self-reported and optional.

### 6.4 `cortex_update_assumption`

Input:
```json
{
  "project_id": "example-api",
  "assumption_id": "assumption-id",
  "status": "refuted",
  "reason": "Route inspection shows middleware is not applied"
}
```
Allowed states: `unverified | supported | refuted | inconclusive`. Persist transitions and timestamps. A state change is an agent-reported assessment, not independently verified truth.

### 6.5 `cortex_review`

Input, claim review:
```json
{"project_id": "example-api", "target_type": "claim", "target_id": "claim-id"}
```

Input, decision review:
```json
{
  "project_id": "example-api",
  "target_type": "decision",
  "decision": "Deploy the authentication changes",
  "claim_ids": ["claim-id"],
  "assumption_ids": ["assumption-id"]
}
```

Output, illustrative:
```json
{
  "review_id": "review-id",
  "target_type": "decision",
  "status": "warning",
  "claim_evaluations": [
    {
      "claim_id": "claim-id",
      "state": "unverified",
      "assurance": "reported_only",
      "criteria_satisfied_as_reported": true
    }
  ],
  "findings": [
    {
      "rule_id": "UNVERIFIED_CLAIM",
      "severity": "warning",
      "record_ids": ["claim-id"],
      "message": "Required criteria have only caller-reported evidence."
    }
  ]
}
```

Implement deterministic rules:
- `MISSING_REQUIRED_EVIDENCE`
- `UNVERIFIED_CLAIM`
- `CONTRADICTORY_EVIDENCE`
- `REFUTED_ASSUMPTION`
- `UNRESOLVED_ASSUMPTION`
- `REPORTED_ONLY_EVIDENCE`
- `INVALID_REFERENCE` (return as input error where appropriate)

Rules must be documented, ordered, stable, and testable. Avoid pretending to infer semantic contradiction from free text.

### 6.6 `cortex_get_context`

Input:
```json
{
  "project_id": "example-api",
  "include": ["claims", "assumptions", "reviews"],
  "limit": 20
}
```
Output: bounded, most-recent records in that project, with stable ordering. No cross-project retrieval; no unbounded dumps. Add pagination only if necessary and explicitly specified.

---

## 7. Data model and persistence

Suggested SQLite tables:

```text
projects
claims
claim_criteria
evidence
assumptions
assumption_events
reviews
review_findings
```

Optional `review_targets` table for immutable references; choose the simplest normalized schema that preserves referential integrity.

### Common fields
- opaque ID (UUID/ULID)
- `project_id` on all project-owned entities
- `created_at`, `updated_at` as UTC ISO 8601
- bounded text, explicit enums, foreign keys

### Requirements
- `PRAGMA foreign_keys = ON`
- SQLite transactions for multi-row writes
- parameterized queries; no interpolated SQL
- schema migrations versioned and tested
- indexes on `(project_id, created_at)` and relevant foreign keys
- every read/update checks `project_id` as well as entity ID
- reviews persist the evaluated findings as a **snapshot**, so later evidence does not rewrite history
- avoid storing full tool transcripts, source code, credentials, or sensitive files by default
- document database location and `CORTEX_DATA_DIR` override
- use safe OS data directory defaults and predictable filesystem permissions where supported
- no network calls in normal operation

### Scope identity
Use a required explicit `project_id` on every tool. Do not derive it from arbitrary caller-provided paths. The caller chooses the ID; this is **logical isolation, not an authentication/security boundary**. Document this honestly.

---

## 8. Review engine design

Keep core evaluation pure and independent from MCP/SQLite where practical:

```text
MCP transport
    ↓ Zod validation
Application services
    ↓
Repositories (SQLite)
    ↓
Pure verification engine
    ↓
Structured review + findings
```

Evaluation should accept a typed snapshot of claim, criteria, evidence, assumptions, and policy; return a deterministic result.

**Rules:**
1. Invalid references fail early; never silently skip them.
2. An unsupported required criterion => unverified.
3. Contradictory evidence => explicit finding; only policy-admissible contradictions can make state `contradicted`.
4. Reported-only evidence => never silently claim high-assurance verification.
5. Refuted assumption in a decision => `blocked_recommendation` (advisory).
6. Unverified assumptions => warning, not automatic failure.
7. Deterministic ordering of findings by severity, rule ID, and record ID.
8. Review includes `policy_version` so results remain interpretable.
9. Review output must explain **what is known, what is reported, and what remains unverified**.

Avoid scores, fake confidence probabilities, semantic inference, and LLM calls.

---

## 9. Example end-to-end scenario

**Goal:** agent claims authentication is complete.

1. Create claim: “All protected API routes deny unauthenticated requests.”
2. Create criteria: integration coverage; expected negative responses.
3. Add caller-reported evidence: “unit tests passed.”
4. Review claim.
5. Cortex reports **unverified**, because unit tests do not fulfill both criteria and provenance is caller-reported.
6. Agent adds claimed integration-test output covering the criteria.
7. Cortex reports `criteria_satisfied_as_reported=true`, but **does not claim independently verified**.
8. Agent proposes deployment relying on a refuted assumption about middleware.
9. Decision review produces `REFUTED_ASSUMPTION` and `blocked_recommendation`.
10. Later session calls `cortex_get_context` and retrieves project state.

This scenario is a **test fixture**, not a claim of autonomous verification.

---

## 10. Security, privacy, and robustness

- Treat every MCP input as untrusted.
- Enforce max lengths/counts, enums, timestamps, and ID formats.
- Never execute evidence text as a command.
- Never fetch evidence URLs or open arbitrary paths in MVP.
- Do not accept arbitrary DB file paths from tools.
- No telemetry, cloud sync, hidden analytics, or external AI requests.
- Use safe error responses without leaking full DB paths or sensitive data.
- Keep stdout reserved for MCP protocol; logs go to stderr.
- Redact secrets in diagnostics; avoid raw content logging.
- Use dependency auditing in CI where feasible.
- Do not describe project-scoped storage as multi-user access control.
- Document threat model: malicious/careless agent may fabricate evidence, misclassify relations, or omit relevant claims; Cortex cannot guarantee truth.
- Use reasonable data retention and deletion guidance; no automatic destructive cleanup in MVP.

---

## 11. Developer experience and repository layout

Suggested structure (adjust only with justification):

```text
cortex-mcp/
├── src/
│   ├── cli.ts
│   ├── server/
│   │   ├── create-server.ts
│   │   └── tools/
│   ├── core/
│   │   ├── models.ts
│   │   ├── verification-engine.ts
│   │   └── rules.ts
│   ├── services/
│   ├── storage/
│   │   ├── db.ts
│   │   ├── migrations/
│   │   └── repositories/
│   └── schemas/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── protocol/
├── examples/
│   └── authentication-verification.md
├── .github/workflows/ci.yml
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── CORTEX_MCP_CODEX_BRIEF.md
```

Document:
- installation and local MCP client configuration (validated against at least one real client);
- CLI startup and data directory;
- tool inputs and outputs;
- security/trust caveats;
- example end-to-end workflow;
- limitations and roadmap.

Package naming (`cortex-mcp`) is provisional until npm availability is checked. Do not publish automatically.

---

## 12. Milestones — strict sequence

### Milestone 0 — Foundation (plan first)

**Scope:** repo inspection, scaffold, strict TS, pnpm, official MCP SDK, Zod, Vitest, lint/format/typecheck, stdio CLI, one minimal health/smoke mechanism, README starter, CI starter, MIT license.

**Acceptance:**
- build succeeds;
- tests/typecheck/lint succeed;
- MCP client can initialize and discover the server;
- stdout is clean MCP protocol;
- no application database schema or verification business logic yet.

**STOP. Wait for approval to start Milestone 1.**

### Milestone 1 — Storage and domain model

**Scope:** SQLite driver choice, migrations, project isolation, entities, typed repositories, transaction handling, DB tests.

**Acceptance:**
- persists across restarts;
- foreign keys and scope constraints enforced;
- cross-project reads/writes rejected;
- migrations reproducible;
- no MCP business tools required yet.

**STOP.**

### Milestone 2 — Claims, criteria, and evidence

**Scope:** `cortex_create_claim`, `cortex_add_evidence`; input validation, provenance capture, MCP integration tests.

**Acceptance:**
- can register a claim with criteria;
- can attach evidence to correct project/claim/criterion;
- caller-reported evidence remains explicitly untrusted;
- invalid IDs and cross-project references fail safely.

**STOP.**

### Milestone 3 — Verification engine and reviews

**Scope:** deterministic rule engine, claim review, decision review, immutable snapshots, `cortex_review`.

**Acceptance:**
- missing evidence => unverified;
- caller-reported success cannot yield unqualified verified;
- contradictory evidence yields a deterministic finding;
- refuted assumption in decision yields advisory blocked recommendation;
- same input snapshot + policy => same findings.

**STOP.**

### Milestone 4 — Assumptions and context recovery

**Scope:** `cortex_track_assumption`, `cortex_update_assumption`, `cortex_get_context`, lifecycle event history, bounded retrieval.

**Acceptance:**
- lifecycle changes recorded;
- prior context survives process restart;
- project isolation and bounded output verified;
- decision reviews can reference assumptions.

**STOP.**

### Milestone 5 — MVP hardening and v0.1.0 readiness

**Scope:** documentation, real MCP-client smoke test, authentication scenario, CI cross-platform if feasible, error handling, packaging dry run, basic benchmark harness.

**Acceptance:**
- clean install/start in documented environment;
- all six MCP tools discoverable and tested;
- no network/API key requirement;
- example demonstrates meaningful warning without fabricated assurance;
- clear limitations and release checklist;
- no publish or GitHub release without approval.

**STOP.**

---

## 13. Test plan and quality gates

### Unit tests
- evaluation precedence and all rule IDs;
- missing/neutral/supporting/contradicting evidence;
- strict policy vs provisional policy;
- refuted/unverified assumptions;
- deterministic ordering;
- boundary lengths and enum validation.

### Integration tests
- migrations and persistence;
- project isolation (same IDs rejected across project scope);
- invalid criterion/claim linkage;
- immutable reviews;
- rollback on failed multi-row writes;
- safe errors.

### MCP tests
- initialization and tool discovery;
- schema validation;
- each tool's happy and unhappy paths;
- stdout protocol purity;
- restart and retrieval.

### Evaluation experiments (after MVP)
Use at least 10–20 realistic coding tasks with objective checks. Compare baseline agent and agent-with-Cortex under similar conditions; repeat runs where possible.

Measure:
- actual task success / independently verified correctness;
- false completion claims detected;
- useful warnings vs false alarms;
- extra tool calls and tokens;
- added latency;
- whether the agent voluntarily uses Cortex.

**Do not claim Cortex improves reliability before measuring it.** Publish negative findings too.

---

## 14. Release strategy

- `v0.1.0`: experimental local MCP, six tools, provenance-aware deterministic reviews, SQLite, documentation, tests.
- `v0.2.0`: assess usability and warning quality; improve evidence workflow; optionally introduce authenticated collectors if justified.
- `v0.3.0`: optional coding-agent hooks/adapters for independently captured test/build evidence; still local-first.
- `v1.0.0`: stable tool contracts, migration compatibility, robust docs, cross-platform validation, repeatable benchmarks.

Version numbers are **targets**, not promises. Do not add features just to reach a version number.

---

## 15. Open-source project standards

- MIT license and contributor-friendly README.
- `CONTRIBUTING.md` with setup, tests, pull-request expectations.
- Clear code of conduct if community contributions grow.
- Small PRs, focused commits, changelog when releasing.
- Avoid exaggerated language such as “prevents hallucinations” or “guarantees correctness.”
- Keep tool schemas stable or document breaking changes.
- Add security disclosure guidance before wider adoption.
- Prefer accessible English documentation and examples.

### Suggested GitHub metadata

**Repository:** `cortex-mcp` (availability unverified)

**Description:**  
`Open-source, local-first MCP server for evidence-backed claim verification and decision reviews in AI agents.`

**Topics:**  
`mcp`, `model-context-protocol`, `ai-agents`, `typescript`, `verification`, `developer-tools`, `open-source`

**README opening:**  
> Cortex MCP helps AI agents make claims accountable to evidence. It records verification criteria, evidence provenance, assumptions, and deterministic review findings — locally, without a separate LLM or cloud service.

---

## 16. Definition of done for v0.1.0

The release is ready only if:

- [ ] Six MCP tools are implemented and documented.
- [ ] TypeScript strict checks, lint, build, and tests pass.
- [ ] Data is local and persists across restarts.
- [ ] All reads/writes enforce project scope.
- [ ] Claims have explicit mandatory verification criteria.
- [ ] Evidence provenance and assurance limitations are visible.
- [ ] Review results are deterministic, explainable, and saved.
- [ ] Reported evidence is never silently treated as independently verified.
- [ ] Refuted assumptions are flagged in decision reviews.
- [ ] A real MCP client can connect via stdio.
- [ ] README includes installation, configuration, example, and limitations.
- [ ] No required cloud account, LLM API, or telemetry.
- [ ] The authentication example passes as a reproducible test.
- [ ] No unapproved publishing or automatic Git commits.

---

## 17. Copy-paste first instruction for Codex

```text
Read CORTEX_MCP_CODEX_BRIEF.md in full. This v2 document is the source of truth.

We are building Cortex MCP incrementally. Follow Section 0 strictly.

For now, inspect the repository and prepare a plan for Milestone 0 ONLY.
Include the files you would create or change, the official MCP SDK
integration approach, risks, and acceptance checks.

DO NOT WRITE CODE, install dependencies, commit, push, or implement
anything yet. Wait for my explicit approval before starting Milestone 0.
```

---

## 18. Final design reminder

**Cortex should not pretend to know what an AI thinks. It should evaluate what an AI claims, what evidence was recorded, how trustworthy that evidence actually is, and what remains unverified.**

The first milestone is not “build an intelligent agent supervisor.” It is “build a reliable foundation for a transparent, local verification protocol.”

**End of brief.**
