---
"@systemfsoftware/stryker-js": major
---

A child process exit code is the POSIX status domain now: any value accepted as a `ChildExitCode` is an integer in `0..255`, and a value outside that range is refused. The out-of-memory exit codes are a named, exported domain instead of a private list, so classifying a worker exit depends on a declared value rather than a hidden one.
