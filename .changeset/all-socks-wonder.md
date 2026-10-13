---
"@systemfsoftware/stryker-js": patch
---

Refuse dry-run coverage recorded under another project root. Coverage now records the project root as the run spells it, the spelling mutant ids are computed from, and a run reuses it only under that same root: coverage from another root, including the same directory reached through a symlink, is refused with the new reason rootChanged, and coverage that records no root is refused once with rootUnrecorded. Either refusal runs a full dry run that records the current root, and its log line names the roots and the next action. Among several restored reports, only coverage recorded under the current root is reused, and only its flaky mutants force a dry run. `plan` prices from that coverage only when the run reuses it; otherwise it estimates from the first report recorded under the current root. Coverage is shared across machines only when they run from the same absolute workspace path.
