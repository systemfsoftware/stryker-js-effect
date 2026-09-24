---
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-html-reporter": minor
"@systemfsoftware/stryker-js-typescript-checker": minor
"@systemfsoftware/stryker-js-vitest-runner": minor
---

Each run stage, checker call, report write and test-runner mutant run now records an OpenTelemetry span named after its cell. The span has `.read` and `.write` child spans and an `app.<name>.decision` or `app.<name>.failure` attribute holding the outcome. It also feeds an `app.<name>.duration` histogram labelled `result_class`.
