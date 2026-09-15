---
'@systemfsoftware/stryker-ignorer-effect-schema-declarations': minor
---

Removed the `decideSchemaDeclarationIgnore` and `CLASS_FIELDS_IGNORED` exports. The ignorer still
registers under the name `effect-schema-declarations` with unchanged recognized declaration shapes
and unchanged ignore reasons. If you called the decision function directly, consult the descriptor
instead: `strykerIgnorers[0].shouldIgnore(node, ancestors)`.
