---
"@systemfsoftware/stryker-js": patch
---

Keep the plan's progress stream out of the projects it prices.

Planning a monorepo from its root walked into the first project and left
`reports/mutation-stream.jsonl` there, which made that project's file set differ
from the set its recorded verdicts were computed against. Running that project
afterwards then refused every verdict as `closureChanged` and mutated everything
again. A relative progress stream file is now resolved against the directory you
invoked the command from, so a plan's stream lands beside the plan output and a
following run of any project reuses its recorded verdicts.
