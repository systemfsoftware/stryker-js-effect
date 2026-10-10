---
"@systemfsoftware/stryker-js-plugin-interface": major
---

Every mutant status, run failure and tool refusal now has a stable reason code, documented in the schema with its meaning and next step. `Mutant.SettledReasonCode` covers mutants that ran (`covered-not-killed`, `not-covered`, `timed-out`, `remembered` and more), `Mutant.RunFailureCode` covers failed or refused runs, and `Mutant.ToolRefusalCode` covers refused CLI and MCP queries. `Mutant.StatusReason` decodes `{ status, statusReason }` from `<code>: <detail>` and accepts only the codes of that status; a `Pending` mutant has no reason.

Breaking:

- `Mutant.IgnoreStatusReason` decodes to `{ code, detail }` instead of `{ ruleId, detail }`; the text form is unchanged. Read `.code` where you read `.ruleId`.
