# @systemfsoftware/stryker-ignorer-workflow-make-boundary

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-workflow-make-boundary)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-workflow-make-boundary)

> Restrict the mutation population to `Workflow.make` bodies.

A workflow's decision bodies are the mutation population; everything else in the file — imports, command classes, wiring, composition — is out of it by design. Any mutant outside a decision body changes the source without changing what the workflow decides, and no test can kill it. Those out-of-population mutants sit in your report forever, indistinguishable from real coverage gaps. This [Stryker](https://stryker-mutator.io) ignorer removes them, so the score that remains measures the deciders.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-workflow-make-boundary
```

In `stryker.config.json`, the plugin module and the ignorer name travel as a pair:

| Config key | Value                                                     |
| ---------- | --------------------------------------------------------- |
| `plugins`  | `@systemfsoftware/stryker-ignorer-workflow-make-boundary` |
| `ignorers` | `workflow-make-boundary`                                  |

```jsonc
{
  "plugins": [
    "@systemfsoftware/stryker-js-vitest-runner",
    "@systemfsoftware/stryker-js-typescript-checker",
    "@systemfsoftware/stryker-ignorer-workflow-make-boundary"
  ],
  "ignorers": ["workflow-make-boundary"]
}
```

Mutants it recognizes are reported as `Ignored`, each carrying the reason it was excluded from the population.

> [!WARNING]
> A name in `ignorers` that no loaded plugin answers is silently skipped — the run proceeds and the mutants stay in your score. Copy the name from the table, not from memory.

> [!NOTE]
> Requires `@systemfsoftware/stryker-js-engine` 4.1.0 or later (the first version whose plugin loader speaks the plain ignorer protocol). The package has no peer dependencies and no Effect types on its published surface — the AST guards are bundled inside `dist`.

## Migrating from `@systemfsoftware/stryker-plugins`

| Before                                            | After                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `"plugins": ["@systemfsoftware/stryker-plugins"]` | `"plugins": ["@systemfsoftware/stryker-ignorer-workflow-make-boundary"]` |
| `"ignorers": ["workflow-make-boundary"]`          | unchanged                                                                |

## What it ignores

Everything outside a `Workflow.make(...)` or `Workflow.total(...)` decision body:

| Outside the population                                                                                                       | Example                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Module-level statements, imports, and command classes in a file binding `Workflow` from `@systemfsoftware/effect-cell-types` | `const cfg = resolveConfig()`                                      |
| Arguments passed to `Workflow.andThen(...)` — a composition, not a decider                                                   | `Workflow.andThen(first, second)`                                  |
| A `Workflow.make`-shaped call whose `Workflow` value comes from any other module                                             | `import { Workflow } from './local-workflow.js'`                   |
| A constructor argument naming a function the file never binds                                                                | `Workflow.make(decideElsewhere)` where no `decideElsewhere` exists |

A mutant **inside** any make or total decision body — including a decider reached by identifier through a same-file `const` binding or named function declaration — stays live.

## Where the line is

This ignorer is a **population selector**, not an equivalence proof: it declares that mutants outside a decider body are not part of the mutation population, so excluding them is correct by construction. Every mutant it ignores is out of population by design, not proven to be behaviour-preserving.

Two consequences worth knowing. A file that never imports `Workflow` from `@systemfsoftware/effect-cell-types` opens no boundary at all, so every mutant in it is out of the population. And a `Workflow.andThen(...)` construction holds no decider of its own — nothing in its argument list joins the population, so it is ignored in full.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
