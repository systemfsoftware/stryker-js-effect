---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-typescript-checker": patch
---

The checker request carries a plain data record, not the instrumenter's `Mutant` class. `CheckerRequest.mutants` and `CheckerService.check`/`group` now speak `CheckerMutantWire` - `id`, `fileName`, `mutatorName`, `replacement`, and `location` - so a host and a worker agree on the payload without importing each other's class. A mutant that cannot be described to a checker is skipped instead of reaching it.

With `OTEL_ENABLED=true` the CLI now exports its OpenTelemetry metrics to `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_METRIC_EXPORT_INTERVAL` sets the export interval in milliseconds. Checker timings, mutant counts, and worker crashes now reach a metrics backend.

`ConfigEnv` and `resolveExtends` are no longer exported from the package root. Import `ConfigEnv` from its config entry point:

```ts
import type { ConfigEnv } from '@systemfsoftware/stryker-js/config'
```
