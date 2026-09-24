---
"@systemfsoftware/stryker-js-html-reporter": minor
---

`makeHtmlReporter` can now be called with the reporter options alone, `makeHtmlReporter(options)`, and handed the reporter init when the run starts. The existing two-argument call, `makeHtmlReporter(options, init)`, keeps working exactly as before and remains the form the engine calls.
