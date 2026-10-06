---
"@systemfsoftware/stryker-js": patch
---

`stryker plan` now reports, per project, how many mutants were reused, how many will run, the refused count by reason, and the reason any whole incremental report was discarded — on the machine `plan` stream line and as one human line per project. A plan that refuses reuse is no longer silent: the next warm run names the reason instead of only pricing a full run.
