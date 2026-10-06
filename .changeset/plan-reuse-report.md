---
"@systemfsoftware/stryker-js-cli-contract": minor
---

A `plan` stream line can now carry a `projects` array naming, for every planned project, how many mutants were reused, how many will run, the refused count per reason, and the reason a whole incremental report was discarded. The machine stream version is unchanged: a stream line without `projects` still decodes, and consumers that read reuse numbers from a plan can now see why a plan scheduled work it expected to reuse.
