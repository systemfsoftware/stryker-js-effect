---
"@systemfsoftware/stryker-js": minor
---

`stryker audit` reports an orphaned test with one of two reasons:

- `every-kill-held-by-a-kept-mutant`: every mutant the test kills is dropped, and every pair of those mutants is a contained Pass. The kept set therefore detects the same faults, and the orphan is reported without failing the audit.
- `every-killed-mutant-dropped`: anything else. It still fails the audit, and `failures.orphanedTests` counts only these.
