# test

Standalone test workspaces, outside the published packages — currently the container-backed `test/e2e` lane.

## Boundaries

- Container-backed lanes are excluded, except `test/e2e` — the E2E lane for the shipped `stryker` artifact — which is isolated by its own `test:e2e` turbo task (`cache: false`): it declares no `test` script (invisible to `pnpm test` and `pnpm check:ci`), runs one digest-pinned container per run, and commits no container state. Self-mutation lanes remain excluded.

Boundary amended per `docs/plans/2026-09-16-0011-feat-stryker-cli-e2e-lane-plan.md` (reversing the KTD5 refusal of `docs/plans/2026-09-13-0704-feat-home-stryker-js-family-plan.md` for the E2E seam only; self-mutation lanes remain excluded).
