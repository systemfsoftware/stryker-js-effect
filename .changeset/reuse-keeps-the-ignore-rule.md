---
"@systemfsoftware/stryker-js": major
---

A verdict reused from the incremental record keeps the reason it was recorded with: a reused Ignored mutant still names its rule on the stream, in the JSON report, and in the next record, and a reused Timeout keeps `wall-clock-timeout`. Whether a verdict was reused is now the record's `remembered` field, no longer a `Remembered` status reason.

Breaking: `incrementalVersion` is now `'5'`. Records from earlier releases are discarded with `cacheLayoutChanged` and the next run is a full run. Read `remembered === true` where you matched `statusReason === 'Remembered'`.
