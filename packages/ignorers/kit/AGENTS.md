# stryker-ignorer-kit

Authoring and testing kit for the Stryker ignorer family. Root `AGENTS.md` governs;
this file carries only what is true of this package.

## Identity

- Two entries: the root exports `defineIgnorer` and the visitor/context types; `./tester`
  exports `testIgnorer` and the case types. The root entry's module graph MUST stay
  parser-free — no `oxc-parser`/`oxc-walker` import reachable from `src/mod.ts` (review gate).
- Zero Effect in any source file or dependency of this package.
- The tester's ancestor-tracking walk mirrors the instrumenter adapter
  (`packages/stryker-js-instrumenter/src/Ast.ts`, `walker`): enter consults with a snapshot of
  the chain excluding the current node, nearest-first; leave pops. Drift between the two walks
  is a review-gated invariant, pinned by the ancestors scenario.
- No backwards-compatibility commitment while this package has no adopters beyond this
  repository's own ignorer migrations: breaking changes are allowed at 0.x; the api reports
  gate drift for this family, not consumer stability.

The reviewer's decision on each `review`-gated line, shown as `wrong:`/`right:`:

- **parser-free entry** — `wrong:` an `oxc-parser` or `oxc-walker` import reachable from
  `src/mod.ts`; `right:` the root entry's graph reaching neither, both parser packages staying
  behind the `./tester` entry.
- **walk parity** — `wrong:` the tester's walk consulting with the live chain including the
  current node, or popping before `leave`; `right:` a snapshot of the chain excluding the
  current node, nearest-first, popped on `leave` — the shape `packages/stryker-js-instrumenter/src/Ast.ts`
  uses.

## Definition of Done

| ID    | Rule                                                                                                              | Gate                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| COV-1 | Coverage runs on every test run and every file under `src` reaches 100% (lines, branches, functions, statements). | `pnpm --filter @systemfsoftware/stryker-ignorer-kit test` |
