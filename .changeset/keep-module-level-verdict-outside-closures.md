---
"@systemfsoftware/stryker-js": patch
---

An incremental mutation run now reuses the verdicts of module-level mutants when an edit cannot reach any test that exercises them, instead of running them again on every edit. An edit that could still reach such a mutant continues to invalidate its verdict, so no previously passing result is kept by mistake.
