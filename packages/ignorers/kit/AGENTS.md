# stryker-ignorer-kit

Authoring and testing kit for the Stryker ignorer family.

## Identity

- Two entries: the root exports `defineIgnorer` and the visitor/context types; `./tester`
  exports `testIgnorer` and the case types. The root entry's module graph MUST stay
  parser-free — no `oxc-parser`/`oxc-walker` import reachable from `src/mod.ts` (review gate,
  plan R3).
- Zero Effect in any source file or dependency of this package.
- The tester's ancestor-tracking walk mirrors the instrumenter adapter
  (`packages/stryker-js-instrumenter/src/Ast.ts`, `walker`): enter consults with a snapshot of
  the chain excluding the current node, nearest-first; leave pops. Drift between the two walks
  is a review-gated invariant, pinned by the U3 ancestors scenario.
- No backwards-compatibility commitment while this package has no adopters beyond this
  repository's own ignorer migrations: breaking changes are allowed at 0.x; the api reports
  gate drift for this family, not consumer stability.

## Boundaries

| Surface       | Examples                                          | Limit        |
| ------------- | ------------------------------------------------- | ------------ |
| **Evaluator** | root `commitlint.config.ts`, `.github/workflows/` | Read-only.   |
| **Doctrine**  | root `CONSTITUTION.md`                            | Project law. |
| **Editable**  | This package's source, tests, docs                | Edit freely. |

## Definition of Done

| ID      | Rule                                                | Gate                |
| ------- | --------------------------------------------------- | ------------------- |
| START-1 | Formatting passes dprint with no diffs              | `pnpm format:check` |
| START-2 | Typechecking succeeds workspace-wide with no errors | `pnpm typecheck`    |
| START-3 | All test suites pass                                | `pnpm test`         |
| START-4 | Full CI validation passes before completion         | `pnpm check:ci`     |
