---
"@systemfsoftware/stryker-js-plugin-interface": minor
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": none
"@systemfsoftware/stryker-js-html-reporter": none
"@systemfsoftware/stryker-js-instrumenter": none
"@systemfsoftware/stryker-js-plugin-runtime": none
"@systemfsoftware/stryker-test-contribution": none
---

A checker that fails now fails mutation testing with that checker's cause, instead of crashing with an empty error. The TypeScript checker type-checks each mutant, so compile errors appear in the report. Verdict counts are non-negative integers; `Metrics` is a class you can build from mutant statuses; a threshold `low` may not exceed `high`.
