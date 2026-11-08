# Cortex MCP v0.1.0 coding evaluation

On 12 coding tasks, Cortex named the missing acceptance check on every incomplete change that submitted only a passing primary check. It also flagged every explicitly reported failure. Overstated pass reports and truthful reports about corrected code produced the same review status, assurance, coverage flag, and rule IDs. Both received a general warning under the strict policy.

## Method

Each task has a first-pass implementation and a corrected implementation in [coding-tasks.mjs](coding-tasks.mjs). I ran both as JavaScript modules in separate temporary directories. The harness used Node assertions to check the code independently of Cortex. Each first pass passed the primary check and failed its edge check. All corrected versions passed both.

| Task              | Check the first pass missed                                 |
| ----------------- | ----------------------------------------------------------- |
| Tenant access     | Reject a document read across tenants.                      |
| Retry idempotency | Prevent a second payment record on retry.                   |
| Cache scope       | Give two accounts distinct cache keys for the same user ID. |
| Pagination        | Keep the next row when it shares the cursor timestamp.      |
| Feature flags     | Honor an explicit false value.                              |
| Time windows      | Exclude the upper boundary.                                 |
| Batch writes      | Leave the destination intact if a later item is invalid.    |
| Asset paths       | Reject absolute paths and parent traversal.                 |
| Webhook retries   | Avoid retrying permanent client errors.                     |
| Log redaction     | Redact tokens inside nested objects and arrays.             |
| Cart totals       | Multiply cents by quantity.                                 |
| Search            | Match equivalent Unicode spellings.                         |

The [runner](run.mjs) sent claims, evidence, and a completion decision to the published v0.1.0 code at commit `6dfef47` over MCP stdio. I ran each of the five conditions on all 12 tasks in three rounds. Each round started a fresh server and database. Each review used its own project. The assertions established whether the code worked, and the harness varied which outcomes it reported to Cortex.

The scripted baseline declared completion when every supplied check was reported as passing. I counted a targeted signal when Cortex returned `MISSING_REQUIRED_EVIDENCE` or `CONTRADICTORY_EVIDENCE`. These trials measure the review rules on controlled submissions. The three rounds repeat the same tasks, so they provide timing and consistency observations. Agent behavior, token usage, and voluntary tool use would require separate trials.

## Results

| Condition                            | Passed both checks | False completions under the scripted baseline | Targeted Cortex signals | Cortex calls per trial |    Median / p95 |
| ------------------------------------ | -----------------: | --------------------------------------------: | ----------------------: | ---------------------: | --------------: |
| First pass, primary check only       |               0/36 |                                         36/36 |                   36/36 |                      3 |  2.85 / 6.83 ms |
| First pass, edge failure reported    |               0/36 |                                          0/36 |                   36/36 |                      4 | 3.92 / 12.77 ms |
| First pass, edge pass overstated     |               0/36 |                                         36/36 |                    0/36 |                      4 | 3.88 / 12.39 ms |
| Corrected code, primary check only   |              36/36 |                                          0/36 |                   36/36 |                      3 |  3.06 / 7.97 ms |
| Corrected code, both passes reported |              36/36 |                                          0/36 |                    0/36 |                      4 | 4.22 / 13.10 ms |

All 180 reviews returned `warning` with `unverified` claims. For corrected code with one missing report, the targeted warning accurately identified a coverage gap even though both independent assertions passed. A consumer that treats every warning as a code defect would also flag all 72 passing submissions. When the caller reported an actual failed check, Cortex emitted both `CONTRADICTORY_EVIDENCE` and `MISSING_REQUIRED_EVIDENCE` because it lacked supporting evidence for that criterion.

Timings cover claim creation, evidence submission, and the decision review through one local stdio connection on macOS with Node.js 26.13.0. They exclude process startup and the independent assertions.

## Recommendations for v0.2.0

1. **Put the reason for a warning first.** Give each required criterion a clear outcome such as missing, reported pass, reported fail, or conflicting reports. Include the criterion key and description so the next check is obvious. Keep the strict assurance result visible. This would also explain why a reported failure currently produces both contradiction and missing-support findings.
2. **Capture test results at the point of execution.** Prototype an opt-in adapter that records the tested revision, command, selected tests, and exit status. Make collector-produced records distinguishable from caller assertions. The overstated-pass trials show why an origin label alone cannot distinguish a failing change from a passing one.
3. **Measure agent behavior before changing the defaults.** Run paired sessions on real repository tasks with hidden acceptance checks and equivalent prompts. Record whether the agent invokes Cortex, how often it acts on warnings, the rate of false completion claims, and the added tool calls and tokens. Use those results to decide whether the warning format or evidence workflow needs another pass.

Reproduce from the repository root with `pnpm build` followed by `node evaluation/run.mjs > cortex-evaluation.json`. The JSON includes the independent check results, each review's rules, and timings.
