# AGENTS.md — `@systemfsoftware/stryker-js-svelte`

The Svelte framework plugin: it claims the `svelte` format for `.svelte` files,
gives the core the instance script and the template expressions of a component
to mutate, and owns the optional `svelte` peer — resolved and version-checked
when its plugin layer is built, never at parse time. It depends inward only: on
`@systemfsoftware/stryker-js-language`, on
`@systemfsoftware/stryker-js-plugin-interface`, on
`@systemfsoftware/stryker-framework-interface`, and on `oxc-walker` for the
Svelte 5 walk. Root `AGENTS.md` governs.

## Rules

| ID       | Rule                                                                                                                                                                                                                                            | Gate                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| -------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------                                                                   | ----------------------------------------------------------------- |
| **SVS1** | The claim is exactly `svelte` over `.svelte`, and every script region parses as the format its `lang` attribute names.                                                                                                                          | `pnpm --filter @systemfsoftware/stryker-js-svelte test`           |
| **SVS2** | The compiler is an optional peer resolved at layer build: a missing compiler refuses the run as a missing peer, one below the supported range as an unsupported version, and the manifest's `peerDependencies.svelte` states the guard's range. | `pnpm --filter @systemfsoftware/stryker-js-svelte test`           |
| **SVS3** | Svelte 5 walks through `oxc-walker`; a compiler that no longer exports `walk` is never used for the walk.                                                                                                                                       | `pnpm --filter @systemfsoftware/stryker-js-svelte test`           |
| **SVS4** | The instrumentation header is placed in the module script, only once mutants land in the component, and never a second time — a component without mutants is left byte-identical.                                                               | `pnpm --filter @systemfsoftware/stryker-js-svelte test`           |
| **SVS5** | No dependency on `@systemfsoftware/stryker-js-instrumenter` or `@systemfsoftware/stryker-js-engine` in any dependency block.                                                                                                                    | `review` — the reviewer reads the dependency blocks               |

SVS5's reviewer decides one thing: whether the plugin still depends inward only.

- `wrong:` `"@systemfsoftware/stryker-js-instrumenter"` or `"@systemfsoftware/stryker-js-engine"` anywhere under `dependencies` or `devDependencies`.
- `right:` the four inward dependencies and the test-only tooling.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-svelte build
pnpm --filter @systemfsoftware/stryker-js-svelte typecheck
pnpm --filter @systemfsoftware/stryker-js-svelte test
pnpm --filter @systemfsoftware/stryker-js-svelte lint
pnpm --filter @systemfsoftware/stryker-js-svelte api:check
pnpm --filter @systemfsoftware/stryker-js-svelte attw
```
