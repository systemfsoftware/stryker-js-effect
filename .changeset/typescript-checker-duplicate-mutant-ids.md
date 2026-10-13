---
"@systemfsoftware/stryker-js-typescript-checker": major
---

A check call that names the same mutant id more than once now fails with the tagged error `DuplicateMutantIds` (code `duplicate-mutant-ids`), whose message asks the caller to send each mutant id once per check call. Callers that sent repeated ids must deduplicate them before calling the checker.
