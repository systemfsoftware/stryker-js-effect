# stryker-js-effect

## Boundaries

| Surface            | Target                                                                                          | Gate              |
| ------------------ | ----------------------------------------------------------------------------------------------- | ----------------- |
| **Evaluator**      | `commitlint.config.ts`, `.github/workflows/`                                                    | Read-only         |
| **Doctrine**       | `CONSTITUTION.md`, `subtrees.toml`                                                              | Read-only         |
| **Vendored**       | `repos/**`                                                                                      | Read-only         |
| **Human approval** | Releases, publishing, external credentials, `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` | User confirmation |
| **Editable**       | Workspace source, tests, documentation                                                          | Edit freely       |

## Definition of Done

| ID        | Obligation                                  | Gate                                                              |
| --------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `START-1` | Code formatting matches dprint              | `pnpm format:check`                                               |
| `START-2` | Workspace typecheck passes                  | `pnpm typecheck`                                                  |
| `START-3` | All test suites pass                        | `pnpm test`                                                       |
| `START-4` | Workspace build and verification tasks pass | `pnpm check:ci`                                                   |
| `START-5` | Package changes include change intent       | `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)` |
