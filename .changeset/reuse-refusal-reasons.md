---
"@systemfsoftware/stryker-js-cli-contract": minor
---

The `reuse` event's `refused` counts gain three reasons: `checkerConfigChanged` (a checker's configuration changed), `entryUnreadable` (a stored verdict could not be decoded) and `storeUnavailable` (the verdict store could not be read). A consumer that decodes `refused` with a closed schema must accept the three new fields.
