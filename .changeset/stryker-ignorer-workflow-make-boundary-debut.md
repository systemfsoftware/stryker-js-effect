---
"@systemfsoftware/stryker-ignorer-workflow-make-boundary": minor
---

first release: the workflow-make boundary ignorer as a standalone package with exactly one runtime dependency (`@systemfsoftware/stryker-ignorer-interface`) and no Effect dependency at all — the mutation population becomes the `Workflow.make` bodies and nothing else; migrate by replacing `"@systemfsoftware/stryker-plugins"` with `"@systemfsoftware/stryker-ignorer-workflow-make-boundary"` in `plugins:` together with `ignorers: ["workflow-make-boundary"]` on `@systemfsoftware/stryker-js-engine` 4.1.0 or later
