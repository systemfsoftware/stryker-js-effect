# stryker-js-effect

The home of the `@systemfsoftware/stryker-js-*` package family: the mutation
engine (`stryker-js-language`), the plugin contract
(`stryker-js-plugin-interface`), the CLI, instrumenter, reporters, checkers, and
test-runner integration.

## Boundaries

| Surface            | Examples                                            | Limit                                                  |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------ |
| **Evaluator**      | `commitlint.config.ts`, `.github/workflows/`        | Read-only; never edit the instrument that grades work. |
| **Doctrine**       | `CONSTITUTION.md`, `subtrees.toml`                  | Project law; edit only on deliberate direction.        |
| **Vendored**       | `repos/**`                                          | Read-only; updated via git subtree, never hand-edited. |
| **Human approval** | Releases, publishing, external credentials          | User-confirmed only.                                   |
| **Supply chain**   | `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` | Human-approved; never widen unasked.                   |
| **Editable**       | Workspace source, tests, documentation              | Edit freely.                                           |

pnpm withholds every version younger than `minimumReleaseAge` (1440 minutes by default,
per pnpm's dependency-resolution settings). `minimumReleaseAgeExclude` in
`pnpm-workspace.yaml` punches holes in that quarantine; today it exempts the whole
`@systemfsoftware/*` scope. Adding an entry to it is a human-approved change: propose it,
name the package and the reason, and wait for the operator.

## Definition of Done

| ID        | Rule                                                            | Gate                                                              |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `START-1` | Formatting passes dprint with no diffs                          | `pnpm format:check`                                               |
| `START-2` | Typechecking succeeds workspace-wide with no errors             | `pnpm typecheck`                                                  |
| `START-3` | All test suites pass                                            | `pnpm test`                                                       |
| `START-4` | The local gate passes before completion                         | `pnpm check:ci`                                                   |
| `START-5` | A change under `apps/**` or `packages/**` ships a change intent | `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)` |

Workspace roots: `packages/` holds libraries — `packages/toolchain/*` is private
build, lint, and test config; `packages/ignorers/*` is the published, zero-Effect
ignorer family — and `apps/` holds publishable applications. Four globs in
`pnpm-workspace.yaml` select them. Turbo declares `dist/**` as each package's
build output; `pnpm gate:dist` runs that build.

## End of Session

Commit changes using conventional commits (`<type>(<scope>): <subject>`). Leave the working tree clean and `pnpm check:ci` green. A change under `apps/**` or `packages/**` also needs a change intent — `pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" <pkg>` — which CI checks in a separate workflow; `pnpm check:ci` does not.
