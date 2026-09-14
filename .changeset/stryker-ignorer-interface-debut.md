---
"@systemfsoftware/stryker-ignorer-interface": minor
---

First release. This is the contract an ignorer is written against: one `Ignorer`
descriptor (`{ name, shouldIgnore }`) whose decision receives the node and its
ancestors — nearest first, fully typed positions, nothing unknown. The whole AST
vocabulary of the producing parser is re-exported with optional spans, so
hand-built fixtures only need the fields a rule actually reads.

Hosts that traverse a tree get `Walker` and `WalkVisitors` types from the same
contract: a walker drives `enter`/`leave` with the node and its ancestor stack,
and the host supplies the traversal itself. The package ships no runtime value
and no runtime dependencies, so adopting it costs nothing beyond the types.
