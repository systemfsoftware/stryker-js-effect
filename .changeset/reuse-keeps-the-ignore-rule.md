---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A reused verdict keeps the reason it was stored with: a reused Ignored mutant still names its rule on the stream and in the JSON report, and a reused Timeout keeps `wall-clock-timeout`. Whether a result was reused is now `RunMutantResult.remembered`, no longer a `Remembered` status reason.

Breaking: read `remembered === true` where you matched `statusReason === 'Remembered'`. An Ignored verdict whose reason names no ignore rule is not stored.
