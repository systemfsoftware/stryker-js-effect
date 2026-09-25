---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
---

Mutation runs with `testRunner: 'vm'` finish in about half the time, with the same verdicts. The engine checks mutant groups on every checker process at once, stops the checkers as soon as checking ends, hands their share of `concurrency` to the test runners, and shares a Node compile cache with every worker it starts. The Vitest runner starts the next isolated worker thread while the current test file runs, so each file still gets a fresh thread but no longer waits for one to boot. On a 319-mutant TypeScript project with the TypeScript checker, a run went from 24.9 s to 12.6 s.
