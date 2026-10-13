---
"@systemfsoftware/stryker-js": patch
---

The built-in reporters are one capability: each reporter declares its name, whether it writes to stdout, and its failure mapping once, and the registry is one list. The SARIF reporter now runs as its own cell, recorded under the `stryker.report.sarif` span. Reporter output, report files, exit codes and the stream are unchanged.
