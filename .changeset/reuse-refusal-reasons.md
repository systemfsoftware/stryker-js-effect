---
"@systemfsoftware/stryker-js-cli-contract": minor
---

Breaking: the machine stream moves to `schemaVersion` `9.0`, because the `reuse` event's `refused` counts gain three required reasons: `checkerConfigChanged` (a checker's configuration changed), `entryUnreadable` (a stored verdict could not be decoded) and `storeUnavailable` (the verdict store could not be read). A reader pinned to stream `8.0` must accept `9.0` and the three new fields.
