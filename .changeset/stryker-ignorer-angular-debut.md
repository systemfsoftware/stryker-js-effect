---
'@systemfsoftware/stryker-ignorer-angular': minor
---

Debut: the Angular signal ignorer as its own package. `strykerIgnorers[0].shouldIgnore(node, ancestors)` suppresses mutations in Angular signal declarations — `input`, `model`, `output`, `viewChild`, `viewChildren`, `contentChild`, `contentChildren` and `query` — recognizing both the signal-function call form and the property-decorator form. The messages explaining each suppression are exported alongside it.
