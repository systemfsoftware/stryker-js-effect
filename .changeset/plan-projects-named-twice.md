---
"@systemfsoftware/stryker-js": patch
---

A `plan` whose `--projects` names one project directory twice, for example `proj-a,./proj-a`, now plans that project once and writes the same plan as naming it once. Before, it wrote no plan. When two equally costly mutant groups from different projects compete for a shard, the plan now orders them by project name first, so it places them the way the documented longest-processing-time rule does.
