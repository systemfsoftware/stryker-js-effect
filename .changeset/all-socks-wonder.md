---
"@systemfsoftware/stryker-js": patch
---

Refuse dry-run coverage recorded under another project root. Coverage now records the real path of the root it was recorded under, and a run reuses it only under that same root: coverage from another root is refused with the new reason rootChanged, and coverage that records no root is refused once with rootUnrecorded. Either refusal runs a full dry run that records the current root, and its log line names the roots and the next action. Among several restored reports, the run and `plan` use the same coverage recorded under the current root, and only its flaky mutants force a dry run. Coverage is shared across machines only when they run from …
