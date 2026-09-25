---
'@systemfsoftware/stryker-vm-harness': patch
---

The vm runner now honours Vitest's `passWithNoTests`. A test file that registers no tests no longer fails the dry run when its Vitest project sets `passWithNoTests: true`, and still fails with `No test suite found in file <path>` when the option is false or unset. The option applies per project, as in Vitest: a root-level `test.passWithNoTests` covers every project, and one project in `test.projects` can opt in while another does not.
