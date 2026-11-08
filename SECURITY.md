# Security and trust

Use [GitHub private vulnerability reporting](https://github.com/sinja-hatamian/cortex-mcp/security/advisories/new) if it is available. Otherwise, contact a maintainer privately before sharing details publicly. Include the affected commit or version, expected behavior, and a minimal reproduction. Redact credentials, database contents, local paths, and full transcripts.

Cortex stores data in a local SQLite database. A process with access to the database files can read or modify them. Project IDs scope application queries and provide logical separation within a database.

A client can fabricate evidence, misclassify its relationship to a criterion, or omit relevant claims. Claimed origins and supplied digests describe what the caller submitted. A provisional result means the records satisfied a configured policy. Decision reviews provide advisory recommendations.

The opt-in test collector runs selected test files with the local user's permissions. Receipts capture the test process exit code and its checkout and runtime details. Test code and dependencies determine what a successful exit means. Processes with write access to the database can modify receipts.

Store short summaries and references in evidence records. Keep secrets, raw tool output, and sensitive files outside the database. See the [README](README.md#local-storage) for the data location and removal steps.
