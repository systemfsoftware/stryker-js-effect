---
"@systemfsoftware/stryker-js": major
---

The incremental cache now identifies the engine by a digest of its installed files instead of a hand-bumped integer. The digest covers the manifest and every file under the paths the `files` field declares, for `@systemfsoftware/stryker-js` and the runner it depends on, as resolved at run time. A verdict written by any other build of the engine is refused with the `semanticsChanged` reason, so a release that changes what a status means no longer depends on someone remembering to bump a constant. A declared path that is missing on disk stops the run instead of being hashed as absent.

Breaking: the incremental report replaces `verdictSemanticsVersion` (an integer) with `engineDigest` (a string), and `incrementalVersion` moves to `'4'`. Reports written by earlier releases are discarded with `cacheLayoutChanged` and the next run is a full run.
