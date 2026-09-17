---
"@systemfsoftware/stryker-js-cli": minor
---

The CLI now exports OpenTelemetry traces when `OTEL_ENABLED=true`: one `stryker.cli.run` span per run, annotated with the outcome (`stryker.run.outcome`), the process exit code (`stryker.run.exit_code`), and the failure text (`stryker.run.error`). Spans export over OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://127.0.0.1:4318`) under `OTEL_SERVICE_NAME` (default `stryker-js`); with `OTEL_ENABLED` unset or false, the CLI emits nothing and takes no exporter dependency at runtime.
