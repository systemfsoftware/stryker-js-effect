---
'@systemfsoftware/stryker-test-contribution': none
---

Tests only, no release: the `judgeTestContribution` laws now generate their commands from a purpose-built schema of the fields the judgement reads instead of deriving them from the command's whole mutation-test report schema, which keeps every property inside its CI run budget.
