## 13.1.0

### Minor Changes

- The `stryker` CLI now continues a caller's trace: when `TRACEPARENT` (and optionally `TRACESTATE`) is set in its environment, the `stryker.cli.run` span and everything beneath it join that trace as a child of the carried span, following the OpenTelemetry environment-carrier specification. An absent or malformed `TRACEPARENT` leaves the run on its own root trace, as before.

### Patch Changes

- The packages now depend on `@systemfsoftware/effect-cell-types` 11.

  - Every tagged error now has a one-line message built from its fields, so a failure names the file, mutant, plugin, worker or exit code involved instead of an empty message. The errors' tags, fields and encoded forms are unchanged.
