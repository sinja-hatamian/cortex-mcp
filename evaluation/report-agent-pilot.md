# Cortex MCP paired coding-agent pilot

On November 8, 2026, both conditions passed all 10 repair tasks. All 20 sessions declared completion, and the withheld checks found zero false completions. The agent invoked Cortex in 0 of the 10 sessions where it was offered. These results show an adoption gap on these exercises. The pilot provides no observations of an agent acting on a Cortex warning or using a collector receipt.

## Method

I ran 20 independent Codex CLI sessions with `gpt-6.1-sol`, Node.js 26.13.0, and Codex CLI `0.166.0-alpha.5.1` on macOS. The model was selected by a CLI preflight and then pinned for every measured session. Both conditions used the CLI's default reasoning settings, an ephemeral session, the workspace-write sandbox, and the same task and final-response schema.

Each authored fixture was a small Git repository containing an implementation, public exports, a README contract, and one public smoke test. Every starting implementation passed that smoke test and failed a withheld acceptance check. I validated the complete check set against a reference fix before running any agent. The fixtures extend the earlier coding-task corpus. They are synthetic repair exercises.

For each task, one session had ordinary coding tools. The other also had Cortex's local MCP tools and a short explanation of the optional collector. The prompt explicitly left Cortex use to the agent. Task order was fixed, and the first condition alternated by task. Each task had one session per condition, with a three-minute session limit.

The agent received the full behavioral contract. Additional assertions were withheld from its prompt and workspace and ran in a separate process after its session ended. A false completion means the final structured response had `completed: true` while at least one acceptance check failed. This pilot tests cooperative coding agents and makes no claim about resisting attempts to locate the grading code.

The CLI JSONL traces supplied tool-call events and token usage. Reported input tokens include cached input. Elapsed time includes CLI and MCP startup and excludes fixture preparation and post-session grading. Raw traces and workspaces are retained under `/private/tmp/cortex-agent-pilot-20261108-valid`. The saved result artifact contains per-session summaries, grading outcomes, patches, and analysis. [Codex event documentation](https://learn.chatgpt.com/docs/non-interactive-mode), [result artifact](results-agent-pilot.json)

## Results

| Measure                              | Baseline | Cortex available |
| ------------------------------------ | -------: | ---------------: |
| Completed sessions                   |    10/10 |            10/10 |
| Tasks passing every acceptance check |    10/10 |            10/10 |
| False completion claims              |     0/10 |             0/10 |
| Sessions invoking Cortex             |     0/10 |             0/10 |
| Collector receipts                   |        0 |                0 |
| Shell command executions             |       44 |               47 |
| Median session time                  |  34.81 s |          39.28 s |
| Total reported input tokens          |  751,341 |          856,158 |
| Cached input tokens                  |  578,944 |          713,984 |
| Input tokens excluding cached input  |  172,397 |          142,174 |
| Output tokens                        |    8,861 |            9,376 |

The median difference within task pairs was +0.64 seconds for the Cortex-available condition. The two condition medians describe a different aggregation. Token counts and timings are descriptive observations from one local run with shared prompt caches. They do not establish a monetary cost difference or a stable latency effect.

| Task                           | Baseline | Cortex available |
| ------------------------------ | -------- | ---------------- |
| Tenant-scoped document lookup  | Pass     | Pass             |
| Payment retry idempotency      | Pass     | Pass             |
| Account-scoped cache keys      | Pass     | Pass             |
| Pagination with timestamp ties | Pass     | Pass             |
| Atomic batch validation        | Pass     | Pass             |
| POSIX asset path containment   | Pass     | Pass             |
| Webhook retry eligibility      | Pass     | Pass             |
| Nested log redaction           | Pass     | Pass             |
| Cart quantity arithmetic       | Pass     | Pass             |
| Unicode-normalized search      | Pass     | Pass             |

Both conditions reached the correctness ceiling on these tasks. Warning usefulness, false alarms, and responses to conflicting evidence remain unmeasured because the agent made no Cortex calls. Availability alone produced no voluntary adoption in this sample.

## Setup failure and correction

A preliminary run used `approval_policy="never"` with the default MCP tool approval setting. An explicit connection probe revealed that MCP calls were blocked. I stopped that run after 11 completed repair sessions and one interrupted session. Those sessions are excluded from the tables above.

The corrected runner explicitly permits calls to the local Cortex server with `default_tools_approval_mode="approve"`. It verifies a successful `cortex_health` call before starting measured sessions. All 20 measured sessions then ran in fresh repositories and data directories. The successful connection probe is recorded separately from the comparison. Preliminary artifacts remain under `/private/tmp/cortex-agent-pilot-20261108`.

## Suggestions for the next version

1. **Test an explicit, opt-in verification workflow.** Add a guided evaluation condition that asks the agent to register criteria, submit observed results, and review before declaring completion. Compare its behavior with the optional-tool condition. This would let us assess warning usefulness and agent responses after invocation.
2. **Make collection usable during ordinary edits.** Every measured repair left an uncommitted patch. The current collector requires a clean checkout, creating a workflow constraint for those repairs. Prototype collection against an explicit snapshot of the edited tree, record its digest, and check that the tested snapshot stays consistent. No agent attempted collection in this pilot, so its effect on adoption needs a separate test.
3. **Increase task difficulty and repeat the pairs.** Use larger repository changes with several interacting acceptance criteria, partial failures, and assumptions that need revision. The current 10/10 baseline leaves little room to detect a correctness improvement. Preserve withheld checks and report unsuccessful runs.

## Reproduce

Use the project's documented Node toolchain and an authenticated local Codex CLI. Build Cortex first. The runner uses the CLI-selected model for its preflight and pins that model for the measured sessions.

```sh
pnpm build
node evaluation/run-agents.mjs
node evaluation/run-agents.mjs --run --output-dir /absolute/path/to/fresh-results
```

The first runner invocation validates fixtures without launching agent sessions. The `--run` invocation uses the signed-in Codex account for preflights and 20 repair sessions. It writes metadata, prompts, event logs, workspaces, grading results, and per-session usage. Each measured run requires a fresh output directory. The source fixtures are in [agent-tasks.mjs](agent-tasks.mjs), and orchestration is in [run-agents.mjs](run-agents.mjs).

Repository validation after adding the evaluation artifacts passed build, type checks, lint, formatting, and all 33 existing tests.
