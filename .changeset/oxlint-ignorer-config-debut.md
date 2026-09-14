---
"@systemfsoftware/oxlint-ignorer-config": minor
---

First release. This is the preset an ignorer package is graded by: it holds a
decision to one path, refuses type assertions and `any` on data read from
outside, and rejects any import that would put the StrykerJS runtime behind an
ignorer — Effect and the family presets included.

It extends nothing, so adopting it is a single `extends: [preset]` entry in
your lint configuration.
