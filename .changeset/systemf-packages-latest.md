---
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-html-reporter": minor
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
"@systemfsoftware/stryker-js-plugin-runtime": minor
"@systemfsoftware/stryker-test-contribution": minor
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
---

Exported functions that take their subject first, such as `strykerCell`, `makeRunLayer`, `mergeConfig`, `instrument`, `causeText`, `makeHtmlReporter`, `withLinkedSpan`, `toMutantRunResult` and `judgeTestContribution`, can now also be called data-last inside `pipe`. Existing calls keep working, including calls that leave out optional trailing arguments.

Each run now records a span for every pipeline stage (prepare, instrument, dry run, mutation test). It also records spans for checker admission, survivor admission, incremental reports, report merging, output-mode detection, the TypeScript checker, and each mutant run in the test runner. Every one of these spans has read and write child spans and records the outcome tag as an attribute, and every span name feeds an `app.<name>.duration` histogram. The packages now build on `@systemfsoftware/effect-cell-types` 10.
