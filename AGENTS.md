# stryker-js-effect

## Boundaries

| Surface            | Target                                              | Gate              |
| ------------------ | --------------------------------------------------- | ----------------- |
| **Evaluator**      | `commitlint.config.ts`, `.github/workflows/`        | Read-only         |
| **Doctrine**       | `CONSTITUTION.md`, `subtrees.toml`                  | Read-only         |
| **Vendored**       | `repos/**`                                          | Read-only         |
| **Human approval** | Releases, publishing, external credentials          | User confirmation |
| **Supply chain**   | `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` | User confirmation |
| **Editable**       | Workspace source, tests, documentation              | Edit freely       |

## Definition of Done

| ID        | Obligation                                                       | Gate                                                              |
| --------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `START-1` | Code formatting matches dprint with zero diffs                   | `pnpm format:check`                                               |
| `START-2` | Workspace typecheck produces zero diagnostic errors              | `pnpm typecheck`                                                  |
| `START-3` | All unit and integration test suites pass                        | `pnpm test`                                                       |
| `START-4` | Workspace build and verification tasks pass                      | `pnpm check:ci`                                                   |
| `START-5` | Changes under `apps/**` or `packages/**` include a change intent | `./scripts/check-changeset.ts $(git merge-base HEAD origin/main)` |

## End of Session

1. Run `pnpm check:ci` and confirm it passes.
2. If files under `apps/**` or `packages/**` changed, run `pnpm change --bump <none|patch|minor|major> --summary "<entry>" <pkg>`.
3. Create git commit with conventional commit format (`<type>(<scope>): <subject>`).
4. Verify working tree is clean.
