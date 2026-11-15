---
"@systemfsoftware/stryker-js-instrumenter": patch
---

Format resolution now decides only which format claims a file; the skip reason is built where the skip is recorded, byte for byte as before, and an unclaimed pinned format id is a decision the type-check disabler turns into its InstrumentError.
