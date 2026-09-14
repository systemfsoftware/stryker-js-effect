# @systemfsoftware/stryker-ignorer-in-source-vitest-block

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-in-source-vitest-block)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-in-source-vitest-block)

> In-source tests are not production behaviour. Stop their mutants from dragging your Stryker score below 100%.

Your `if (import.meta.vitest)` blocks are stripped before production, so nothing that runs in a mutation run can ever reach their mutants. They sit in the report forever, indistinguishable from real coverage gaps. This [Stryker](https://stryker-mutator.io) ignorer removes them, so the score that remains is production behaviour.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-in-source-vitest-block
```

In `stryker.config.json`, the plugin module and the ignorer name travel as a pair:

| Config key | Value                                                     |
| ---------- | --------------------------------------------------------- |
| `plugins`  | `@systemfsoftware/stryker-ignorer-in-source-vitest-block` |
| `ignorers` | `in-source-vitest-block`                                  |

```jsonc
{
  "plugins": [
    "@systemfsoftware/stryker-js-vitest-runner",
    "@systemfsoftware/stryker-js-typescript-checker",
    "@systemfsoftware/stryker-ignorer-in-source-vitest-block"
  ],
  "ignorers": ["in-source-vitest-block"]
}
```

Mutants it recognizes are reported as `Ignored`, each carrying the reason it was safe to skip.

> [!WARNING]
> A name in `ignorers` that no loaded plugin answers is silently skipped — the run proceeds and the mutants stay in your score. Copy the name from the table, not from memory.

> [!NOTE]
> Requires `@systemfsoftware/stryker-js-engine` 4.1.0 or later (the first version whose plugin loader speaks the plain ignorer protocol). The package has no peer dependencies, no Effect dependency at all, and exactly one dependency — `@systemfsoftware/stryker-ignorer-interface`, whose node types declare the AST shapes the guards read.

## Migrating from `@systemfsoftware/stryker-plugins`

| Before                                            | After                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `"plugins": ["@systemfsoftware/stryker-plugins"]` | `"plugins": ["@systemfsoftware/stryker-ignorer-in-source-vitest-block"]` |
| `"ignorers": ["in-source-vitest-block"]`          | unchanged                                                                |

## What it ignores

| Guard shape                                                | Example                                         |
| ---------------------------------------------------------- | ----------------------------------------------- |
| The bare Vitest flag                                       | `if (import.meta.vitest) { … }`                 |
| The flag on either side of a comparison                    | `if (import.meta.vitest === undefined) { … }`   |
| Any mutant whose ancestors include one of the guards above | the whole guarded block, test fixtures included |

## Where the line is

The ignored mutants are _unreachable_, not merely believed equivalent: the guard is false under the mutation run, so no test can exercise what is inside it. That is a different claim from a proven-equivalent mutant, and it is why the reason constant says so.

- A flag on a different meta property (`import.meta.env`) or on a non-import meta (`require.meta.vitest`) is **not** a guard — its mutants stay live.
- A bare `import.meta.vitest` expression without an enclosing `if` is **not** a guard.
- Only the guard shape is recognized; ordinary `if` statements keep every mutant, because their branches are reached in production.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
