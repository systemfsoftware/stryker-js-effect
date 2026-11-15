---
"@systemfsoftware/stryker-js-plugin-runtime": patch
---

Trace.withLinkedSpan runs the wrapped effect under the linked span, so spans the asynchronous work starts nest beneath it in the linked trace.
