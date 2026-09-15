# @systemfsoftware/stryker-ignorer-kit

Authoring DSL (`defineIgnorer`) and snippet test runner (`testIgnorer`) for Stryker AST ignorers.

## Rules

| ID        | Obligation                                                                                 | Gate                                                      |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **IK1**   | Root entrypoint (`src/mod.ts`) must not import `oxc-parser` or `oxc-walker`                | `review`                                                  |
| **IK2**   | Zero `effect` or `@effect/*` dependencies across source or package manifest                | `pnpm --filter @systemfsoftware/stryker-ignorer-kit lint` |
| **IK3**   | Ancestor AST walk in test harness must match `packages/stryker-js-instrumenter/src/Ast.ts` | `review`                                                  |
| **IK4**   | Zero backwards-compatibility guarantees during 0.x release series                          | `review`                                                  |
| **COV-1** | Test coverage across `src/` must reach 100% lines, branches, functions, and statements     | `pnpm --filter @systemfsoftware/stryker-ignorer-kit test` |

### Calibration pairs

- **IK1** — `wrong:` importing parser utilities in `src/mod.ts`; `right:` parser dependencies isolated to `./tester` subpath.
- **IK3** — `wrong:` test harness walk mutating node stack during traversal; `right:` passing immutable nearest-first ancestor snapshot.
- **IK4** — `wrong:` adding deprecated aliases to preserve obsolete 0.x API shapes; `right:` clean breaking changes with changeset notes.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-kit build
pnpm --filter @systemfsoftware/stryker-ignorer-kit typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-kit test
pnpm --filter @systemfsoftware/stryker-ignorer-kit lint
pnpm --filter @systemfsoftware/stryker-ignorer-kit attw
```
