---
"@systemfsoftware/stryker-js-instrumenter": patch
---

The default mutant-set policy compares the code each candidate plants: the printed node without its outer parentheses, as the placers unwrap it. It no longer strips parentheses from text, which miscounted a parenthesis inside a string, regex, template or comment.
