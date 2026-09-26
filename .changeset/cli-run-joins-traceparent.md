---
"@systemfsoftware/stryker-js": minor
---

The `stryker` CLI now continues a caller's trace: when `TRACEPARENT` (and optionally `TRACESTATE`) is set in its environment, the `stryker.cli.run` span and everything beneath it join that trace as a child of the carried span, following the OpenTelemetry environment-carrier specification. An absent or malformed `TRACEPARENT` leaves the run on its own root trace, as before.
