# @systemfsoftware/stryker-ignorer-interface

Type definitions and AST walker abstractions for Stryker ignorer plugins.

## Rules

| ID      | Obligation                                                                                   | Gate                                                             |
| ------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **SI1** | Zero `effect` or `@effect/*` imports across source files and emitted types                   | `pnpm --filter @systemfsoftware/stryker-ignorer-interface lint`  |
| **SI2** | Zero `effect` or `@effect/*` packages in manifest `dependencies` or `devDependencies`        | `review`                                                         |
| **SI3** | Types-only package: `dist/index.mjs` must be empty and all exports must be type declarations | `pnpm --filter @systemfsoftware/stryker-ignorer-interface build` |
| **SI4** | `shouldIgnore` returns reason string or `undefined`, never raw boolean                       | `review`                                                         |
| **SI5** | Published API surface matches `etc/stryker-ignorer-interface.api.md`                         | `pnpm --filter @systemfsoftware/stryker-ignorer-interface build` |
| **SI6** | Type-level contracts verified via Vitest typecheck mode in `tests/interface.test-d.ts`       | `pnpm --filter @systemfsoftware/stryker-ignorer-interface test`  |

### Calibration pairs

- **SI2** — `wrong:` adding `"effect": "catalog:"` to package.json; `right:` zero runtime dependencies.
- **SI4** — `wrong:` `shouldIgnore(node): boolean`; `right:` `shouldIgnore(node, ancestors): string | undefined`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-interface build
pnpm --filter @systemfsoftware/stryker-ignorer-interface typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-interface test
pnpm --filter @systemfsoftware/stryker-ignorer-interface lint
pnpm --filter @systemfsoftware/stryker-ignorer-interface attw
```
