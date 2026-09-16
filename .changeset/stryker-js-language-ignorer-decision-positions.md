---
"@systemfsoftware/stryker-js-language": major
---

An ignore rule's decision now receives the node and its ancestors as typed
positions instead of a path object, and it answers with the ignore reason or
nothing. A rule authored against the previous shape must be updated to the new
signature.
