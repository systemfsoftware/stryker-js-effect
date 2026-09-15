# @systemfsoftware/stryker-js-engine

Platform-agnostic mutation test execution engine: orchestrates mutants, test runners, checkers, and reporters.

## Rules

| ID      | Obligation                                                                                                               | Gate                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **EN1** | Zero `@effect/platform-*` in manifest `dependencies` and zero `engines` field in `package.json`                          | `pnpm --filter @systemfsoftware/stryker-js-engine attw` |
| **EN2** | `makeRunLayer` must accept `FileSystem`, `Path`, `ChildProcessSpawner`, `Module`, and socket port as explicit parameters | `review`                                                |
| **EN3** | Workers addressed strictly by `entryUrl` strings pointing to CLI dist entries                                            | `review`                                                |

### Calibration pairs

- **EN2** — `wrong:` `makeRunLayer` imports and instantiates NodePlatform directly; `right:` all platform capabilities are passed as parameterized dependencies.
- **EN3** — `wrong:` engine imports worker scripts directly from its own source paths; `right:` worker paths are passed in via `entryUrl` parameters.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-engine build
pnpm --filter @systemfsoftware/stryker-js-engine typecheck
pnpm --filter @systemfsoftware/stryker-js-engine test
pnpm --filter @systemfsoftware/stryker-js-engine lint
```
