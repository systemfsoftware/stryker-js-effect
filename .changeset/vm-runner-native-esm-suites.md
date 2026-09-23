---
"@systemfsoftware/stryker-js": patch
---

The in-memory V8 VM runner (`testRunner: 'vm'`) now executes suites written for `vitest`, `@effect/vitest`, and `@systemfsoftware/effect-gherkin-spec` out of the box: the usual test surface — `describe`/`it`, `.skip`, `.only`, `.todo`, `.each`, `it.fails`, and hooks — behaves as it does under vitest, and each test is reported on its own with its real failure message instead of one all-tests result. Mutant runs attribute a kill to the exact test that caught the change. A suite that never finishes yields a timeout result instead of hanging the run, unhandled rejections are captured in the run report, module state is fresh on every run, and a suite that cannot compile still fails the run with a typed failure naming the file.
