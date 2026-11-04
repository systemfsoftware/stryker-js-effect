---
"@systemfsoftware/stryker-js-cli-contract": major
---

Regenerate the stream schema on effect 4.1.0, which writes the safe-integer range onto every integer and non-negative integer field (`minimum` 0 and `maximum` 9007199254740991, or both bounds for signed integers). A consumer that validates a stream line against the published document now refuses an integer beyond 2^53 - 1, which the previous document admitted.

The run stream moves to schema version 9.0, because the contract version law counts the narrower integer fields as a breaking stream change.
