---
"@systemfsoftware/stryker-vm-harness": patch
---

A project reached through a symbolic link now runs in the in-memory runner. Before this fix, every test file in such a directory failed to load; on macOS that includes projects under `/tmp`, which links to `/private/tmp`. The runner now resolves the working directory and each test file to its real path before loading.
