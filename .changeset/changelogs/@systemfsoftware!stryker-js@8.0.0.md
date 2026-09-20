## 8.0.0

### Major Changes

- The checker request carries a plain data record, not the instrumenter's `Mutant` class. `CheckerRequest.mutants` and `CheckerService.check`/`group` now speak `CheckerMutantWire` - `id`, `fileName`, `mutatorName`, `replacement`, and `location`. A mutant that cannot be described to a checker is skipped instead of reaching it.

  With `OTEL_ENABLED=true` the CLI now exports its OpenTelemetry metrics to `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_METRIC_EXPORT_INTERVAL` sets the export interval in milliseconds. Checker timings, mutant counts, and worker crashes now reach a metrics backend.

  `ConfigEnv` and `resolveExtends` are no longer exported. Import `ConfigEnv` from the config entry point of the package, and read merged options with `loadConfigCell` or `readConfig` from the package root - either performs the `extends` walk, validation and merge in order.
