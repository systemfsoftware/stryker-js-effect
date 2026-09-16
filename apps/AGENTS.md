# apps

Application entrypoints and executables.

## Boundaries

- Executable bundles must inline internal workspace dependencies or restrict runtime dependencies to `node:` builtins.
- Binaries point to gitignored `dist/` targets; manifests must retain `prepare` scripts to ensure shims resolve after fresh installs.
- Container-backed lanes are excluded, except `apps/stryker-js-cli-e2e` — the E2E lane for the shipped `stryker` artifact — which is isolated by its own `test:e2e` turbo task (`cache: false`): it declares no `test` script (invisible to `pnpm test` and `pnpm check:ci`), runs one digest-pinned container per run, and commits no container state. Self-mutation lanes remain excluded.
- Bundled reporters (e.g. `reporters/html.mjs`) must escape report data via `escapeHtmlTags` before interpolation.

Boundary amended per `docs/plans/2026-09-16-0011-feat-stryker-cli-e2e-lane-plan.md` (reversing the KTD5 refusal of `docs/plans/2026-09-13-0704-feat-home-stryker-js-family-plan.md` for the E2E seam only; self-mutation lanes remain excluded).
