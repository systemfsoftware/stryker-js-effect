---
"@systemfsoftware/stryker-js-typescript-checker": major
---

A check call that names the same mutant id more than once now fails with reason `duplicate-mutant-ids`, and the message asks the caller to send each mutant id once per check call. Callers that sent repeated ids must deduplicate them before calling the checker.
