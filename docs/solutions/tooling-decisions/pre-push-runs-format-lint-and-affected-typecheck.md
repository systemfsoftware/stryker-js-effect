---
title: Pre-push runs format, lint and affected typecheck after the existing gates
date: 2026-11-12
category: tooling-decisions
module: repo
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "editing .husky/pre-push"
symptoms:
  - "pre-push checked only that the pushed tip contains origin/main and the plan-file limit, so pushes skipped format, lint and typecheck"
root_cause: config_error
resolution_type: config_change
---

# Pre-push runs format, lint and affected typecheck after the existing gates

Agents run format, lint and typecheck before every push. Tests run only in CI.

`.husky/pre-push` keeps its origin/main containment check and its single-plan gate, then runs `format:check`, `lint`, and `turbo run typecheck lint --affected` with base = the merge-base with the remote main sha it already read. The hook runs no test task.
