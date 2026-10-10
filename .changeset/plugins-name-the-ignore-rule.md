---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js": major
---

Plugins that ignore a mutant must now say why. Each ignore rule id (`Mutant.IgnoreRuleId`) is documented in the schema with what it means and the option that keeps its mutants; the ids are stable.

Breaking:

- A checker answering `ignored` must give a reason of the form `<rule-id>: <detail>`, or the run fails naming the checker and the mutant. A third-party checker with no rule of its own uses the new `checker` rule: `checker: <detail>`.
- An ignorer whose `shouldIgnore` returns an empty or non-string reason now fails instrumentation, naming the ignorer, the mutant id, and the file. Return a non-empty string to ignore a mutant, or `undefined` to keep it.
