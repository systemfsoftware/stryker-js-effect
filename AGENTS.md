# stryker-js-effect

An Effect-based fork of StrykerJS: mutation testing for TypeScript, shipped as the `@systemfsoftware/stryker-*` npm packages and the flake's `stryker` package. Every mutant verdict this tool prints is a claim a consumer acts on, so a wrong verdict is the worst defect this repository can ship.

`AGENTS.md` is the canonical instruction file; `CLAUDE.md` is a symlink to it. Subtrees add their own `AGENTS.md` (`packages/`, `packages/frameworks/`, `packages/ignorers/`, `packages/toolchain/`, `test/`, `test/e2e/`); the nearest one to a file applies on top of this one.

- `CONSTITUTION.md` is the design law (domain modelling, code shape, proof, finish). It outranks every other file; read it before an architecture change, a design dispute or a new rule.
- `CODING_STANDARDS.md` (with `packages/ignorers/CODING_STANDARDS.md` for its subtree) holds the defect classes code here must avoid. Read it before writing or reviewing code, and update it in the same change when a fix establishes or retires a rule.
- `REVIEW.md` holds how review behaves here: severities and the evidence a finding needs. Read it before reviewing.

## Layout

| Path                                               | What it holds                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/stryker-js`                              | The engine and the `stryker` CLI: plan, run, gate, merge, audit                                           |
| `packages/stryker-js-instrumenter`                 | Parsing, mutators and mutant placement                                                                    |
| `packages/stryker-js-vitest-runner`                | The Vitest test runner plugin (worker process)                                                            |
| `packages/stryker-js-typescript-checker`           | The TypeScript checker plugin (worker process)                                                            |
| `packages/stryker-js-cli-contract`                 | The machine stream, span taxonomy and CLI wire contract consumers decode                                  |
| `packages/stryker-js-plugin-interface`, `-runtime` | What a plugin implements, and the runtime that hosts it                                                   |
| `packages/stryker-js-html-reporter`                | The HTML report                                                                                           |
| `packages/frameworks/*`, `packages/ignorers/*`     | Framework format plugins (Angular, Svelte) and ignorers that drop equivalent mutants                      |
| `packages/toolchain/*`                             | Shared tsdown, vitest, oxlint and Stryker presets                                                         |
| `test/e2e`, `test/e2e-core`                        | The end-to-end lane: the shipped `stryker` package run in microVMs against fixtures                       |
| `test/checker-parity`, `test/bench`                | The branch checker's verdicts and type-query answers compared with main's, and report-only A/B benchmarks |
| `repos/`                                           | Vendored reference subtrees (`subtrees.toml`); read them for upstream source, never edit or build them    |
| `docs/plans`, `docs/solutions`, `docs/adr`         | Plans (point-in-time records), solved problems, and decisions                                             |

## Commands

The dev shell (`nix develop`, or direnv) provides Node, pnpm, dprint, gritlint and Deno at the pinned versions.

```bash
pnpm install --frozen-lockfile
pnpm check:ci        # what CI runs: format, conventions, then build, api:check, lint, typecheck and test of what changed since origin/main
pnpm check:full      # the same over every package, as CI runs on main
pnpm exec turbo run test --filter <package>   # one package's suite, after building what it depends on
pnpm --filter <package> api:update            # regenerate etc/*.api.md after a change to a published surface
pnpm format          # dprint fmt
pnpm lgtm:up && pnpm test:e2e   # the e2e lane: needs /dev/kvm; see test/e2e/AGENTS.md for its environment
```

A check that fails prints what failed and the command that reproduces it locally; run that command before changing anything. Everything above runs inside the dev shell.

## Boundaries

| Surface        | Target                                                                                        | Rule                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Read-only      | `CONSTITUTION.md`, `subtrees.toml`, `repos/**`, `commitlint.config.ts`                        | Change only on an explicit request; `repos/` moves only through a subtree update                                         |
| Dogfood        | The `@systemfsoftware/stryker-*` devDependencies the mutation and checker-parity runs install | Caret ranges on released npm versions, never `workspace:^`: those runs test the released CLI; a release moves the ranges |
| Human approval | Releases, publishing, credentials, `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`        | Ask first                                                                                                                |
| Editable       | Workspace source, tests, fixtures, workflows, documentation                                   | Edit freely; see "CI" below before changing a workflow                                                                   |

This repository is public. Nothing from a private repository enters it: no private repository, package or product name, host, path, person, private link or issue id, in files, commit messages or PR text (pack: public-repository).

## Process

- Work follows the compound-engineering loop: brainstorm, plan, work, simplify, review, compound. The repository enrolls every systemfsoftware compound pack in `.compound-engineering/config.yaml`; planning and review cite a pack rule as `(pack: <id>, <file>)`.
- A plan lives in `docs/plans/<yyyy-mm-dd-hhmm>-<type>-<slug>-plan.md`. A plan from an earlier change stays as written.
- A solved problem worth knowing next time becomes a `docs/solutions/<category>/<slug>.md` record with `title`, `module`, `tags` and `problem_type` frontmatter, in the same change as its fix. Categories: `architecture-patterns`, `best-practices`, `build-errors`, `performance-issues`, `runtime-errors`, `security-issues`, `test-failures`, `tooling-decisions`, `workflow-issues`.
- A change to a publishable package carries a change intent in `.changeset/` (`pnpm change`); a break bumps `major`, or `minor` while the package is `0.x`. Never hand-edit versions, `CHANGELOG.md` or `.changeset/ledger.yaml`; the release workflow owns them.
- A pull request title is a conventional commit typed by intent, with the narrowest useful scope.
- Diagnose an end-to-end or mutation failure from its exported traces, never by adding print statements or retrying until it passes: CI uploads each leg's `e2e-telemetry-*` artifact, and `pnpm lgtm:up` serves traces locally. `test/e2e/README.md` has the runbook.
- A failure whose cause lies in a library this repository depends on from systemfsoftware (effect-gherkin-spec, trace-spec, the vitest, tsdown and oxlint presets, effect-cell-types) is fixed in that library's repository, not worked around here.

## CI

- `ci.yml` calls the organization's shared CI workflow; its `check` job runs `pnpm check:ci` on a pull request and `pnpm check:full` on main, and is the required status check. Renaming or splitting that job renames the required check in the same change.
- The e2e, checker-parity, bench and mutation lanes each run in their own workflow and never inside `check`: they need KVM, a collector or a released CLI that `check` does not have.
- A CI job catches a defect a consumer of a shipped package would meet. It never grades this repository's own docs, plans, layout, timings or cost, and never duplicates another job (the ci-workflows pack).
