---
"@systemfsoftware/stryker-js": major
---

A `plan` whose `--projects` names one project directory twice, whether by a second path such as `proj-a,./proj-a` or through a symlink, now plans that project once and writes the same plan as naming it once. Before, it planned that project's mutants twice. When two equally costly mutant groups from different projects compete for a shard, the plan now orders them by project name first, so it places them the way the documented longest-processing-time rule does.

A `plan` the planner cannot accept, such as `--target-seconds 0`, now exits with code 2 and names the refused input and what to change, instead of crashing.

Breaking: `Engine.planRequest` can now fail with `PlanShardsRefused`, which `Engine` exports.
