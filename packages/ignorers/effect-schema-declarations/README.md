# @systemfsoftware/stryker-ignorer-effect-schema-declarations

![version](https://img.shields.io/npm/v/@systemfsoftware/stryker-ignorer-effect-schema-declarations)
![license](https://img.shields.io/npm/l/@systemfsoftware/stryker-ignorer-effect-schema-declarations)

> Stop Effect `Schema` declarations from dragging your Stryker score below 100%.

A brand description, a `_tag`, a `title` — mutate any of them and the source changes but the behaviour does not, so no test can ever kill the mutant. Those unkillable mutants sit in your report forever, indistinguishable from real coverage gaps. This [Stryker](https://stryker-mutator.io) ignorer removes them, so the score that remains is behaviour.

## Install

```bash
pnpm add -D @systemfsoftware/stryker-ignorer-effect-schema-declarations
```

In `stryker.config.json`, the plugin module and the ignorer name travel as a pair:

| Config key | Value                                                         |
| ---------- | ------------------------------------------------------------- |
| `plugins`  | `@systemfsoftware/stryker-ignorer-effect-schema-declarations` |
| `ignorers` | `effect-schema-declarations`                                  |

```jsonc
{
  "plugins": [
    "@systemfsoftware/stryker-js-vitest-runner",
    "@systemfsoftware/stryker-js-typescript-checker",
    "@systemfsoftware/stryker-ignorer-effect-schema-declarations"
  ],
  "ignorers": ["effect-schema-declarations"]
}
```

Mutants it recognizes are reported as `Ignored`, each carrying the reason it was safe to skip.

> [!WARNING]
> A name in `ignorers` that no loaded plugin answers is silently skipped — the run proceeds and the mutants stay in your score. Copy the name from the table, not from memory.

> [!NOTE]
> Requires `@systemfsoftware/stryker-js-engine` 4.1.0 or later (the first version whose plugin loader speaks the plain ignorer protocol). The package has no peer dependencies, exactly one dependency — `@systemfsoftware/stryker-ignorer-interface`, which supplies AST node types only — and no Effect anywhere, not in `dependencies`, not in `devDependencies`, and not on its published surface. The guards are this package's own predicates over those node shapes.

## Migrating from `@systemfsoftware/stryker-plugins`

| Before                                            | After                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `"plugins": ["@systemfsoftware/stryker-plugins"]` | `"plugins": ["@systemfsoftware/stryker-ignorer-effect-schema-declarations"]` |
| `"ignorers": ["effect-schema-declarations"]`      | unchanged                                                                    |

## What it ignores

| Declaration                                               | Example                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Brand descriptions                                        | `Symbol.for('UserId')`                                            |
| `TaggedClass` / `TaggedError` tags                        | `S.TaggedClass<A>()('Placed', {…})`                               |
| The field schemas of those declarations                   | the `{…}` above                                                   |
| `optionalWith` defaults                                   | `S.optionalWith(S.Number, { default: () => 0 })`                  |
| Documentation annotations                                 | `identifier`, `description`, `title`, `documentation`, `examples` |
| An `annotations({…})` object that is _only_ documentation | `S.annotations({ title: 'Amount' })`                              |

## Where the line is

Every ignore is proven redundant, never merely assumed — anything a test could observe keeps its mutants.

`arbitrary`, `pretty`, `equivalence`, `message`, `jsonSchema` and `parseIssueTitle` are **not** documentation: each changes what the schema does, so a survivor there is a test gap to close. That is why the two `annotations` rules differ — a `title` is ignored wherever it appears, but the enclosing object is ignored only when every entry documents, since emptying an object holding an `arbitrary` would silently change what your property tests generate.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
