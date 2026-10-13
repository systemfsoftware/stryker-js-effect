---
"@systemfsoftware/stryker-js-plugin-runtime": major
---

Breaking: `Worker.WorkerOptions.layer` is now `Worker.WorkerOptions.layerConfig`, and `Worker.WorkerTelemetry.layer` is now `Worker.WorkerTelemetry.layerConfig`, because both build their service from configuration. Each keeps its type and behaviour. Rename the member where your worker entry provides it.
