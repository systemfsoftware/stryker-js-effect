# AGENTS.md — `@systemfsoftware/oxlint-ignorer-config`

The published lint preset for an ignorer package. It extends nothing: the rule
set is assembled in `lib/base.js` from the linter's built-in plugins and
categories, so an ignorer authored outside this repository is graded by the
same bar as the ones inside it. Root `AGENTS.md` governs.

## Rules

| ID  | Rule                                                                                                                                                                    | Gate             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| OC1 | A decision stays one path: `complexity` max 2 on `**/src/**`, ternary form allowed                                                                                      | `pnpm lint`      |
| OC2 | Foreign data is decoded, never asserted: `consistent-type-assertions` (`never`), `no-unsafe-*`, `no-explicit-any`, `no-non-null-assertion`                              | `pnpm lint`      |
| OC3 | No runtime behind an ignorer: `no-restricted-imports` rejects Effect, `@effect/*`, the family Effect presets, the family rule packs and `@systemfsoftware/stryker-js-*` | `pnpm lint`      |
| OC4 | Tests observe decisions: `vitest/no-focused-tests`, `vitest/no-conditional-expect`                                                                                      | `pnpm lint`      |
| OC5 | The published shape is declared: `lib/base.d.ts` matches `etc/oxlint-ignorer-config.api.md`                                                                             | `pnpm api:check` |
| OC6 | `lib/base.js` is type-checked, so its JSDoc `@type` annotations are load-bearing                                                                                        | `pnpm typecheck` |

## Commands

```bash
pnpm --filter @systemfsoftware/oxlint-ignorer-config typecheck
pnpm --filter @systemfsoftware/oxlint-ignorer-config api:update   # after an intentional surface change
pnpm --filter @systemfsoftware/oxlint-ignorer-config api:check
```

## Notes

- `lib/base.js` is the source. There is no build step; the JSDoc annotations are
  what `tsc` checks, so removing one is a behaviour change, not a tidy-up.
- Changing the rule set changes every adopting package's gate. Treat a rule
  addition as a breaking change to the preset, and say so in the changeset.
