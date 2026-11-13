---
"@systemfsoftware/stryker-js": patch
---

An unchanged re-run now reuses a subsumed mutant's Ignored verdict when one of its dominators is reused as Killed, Survived, Timeout, NoCoverage or RuntimeError, instead of counting it under `decidedPerRun`. A run that leaves every dominator out, for example one restricted with `mutantIds`, still decides the subsumed mutant again and re-admits it. A re-admitted mutant's verdict is not stored.
