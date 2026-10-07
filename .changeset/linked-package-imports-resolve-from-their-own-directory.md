---
"@systemfsoftware/stryker-js": patch
---

An incremental run in a workspace now keeps the verdicts of mutants whose tests reach a linked sibling package. Stryker used to look up that package's own imports under the project root instead of next to the package, so an import the project does not install itself (a dependency only the sibling declares) went unresolved. Every test closure through that package then counted as open, and any edit anywhere re-ran its mutants. Bare imports now resolve the way Node resolves them, from the importing file's directory upwards.
