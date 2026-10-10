---
"@systemfsoftware/stryker-js-cli-contract": minor
---

Breaking: the machine stream moves to `schemaVersion` `7.0`. The `reuse` event's `refused` counts gain three required reasons: `checkerConfigChanged` (a checker's configuration changed), `entryUnreadable` (a stored verdict could not be decoded) and `storeUnavailable` (the verdict store could not be read). A consumer pinned to stream `6.0` must accept `7.0` and the three new fields.
