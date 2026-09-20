## 9.0.0

### Major Changes

- The incremental file now carries `incrementalVersion` (the Stryker package version). Stryker writes it on every incremental run and discards an incremental file it cannot parse or whose `incrementalVersion` differs from the running version, falling back to a full mutation testing run instead of failing. `IncrementalReportSchema` requires `incrementalVersion`, and `decodeIncrementalReport` and `IncrementalReportError` are no longer exported.
