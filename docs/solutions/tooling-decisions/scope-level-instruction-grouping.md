---
title: Scope-level instruction grouping eliminates leaf rule redundancy while preserving invariants
date: 2026-09-16
category: tooling-decisions
module: harness
problem_type: documentation_drift
component: tooling
severity: medium
applies_when:
  - "Refactoring or consolidating AGENTS.md / CLAUDE.md instruction trees across a monorepo"
  - "Deciding where shared package family constraints (e.g. zero-Effect boundaries) should live"
symptoms:
  - "Dozens of leaf AGENTS.md files duplicating generic compiler and linter commands (pnpm test, pnpm lint)"
  - "Redundant per-leaf tables competing for context window budget on each turn"
root_cause: documentation_sprawl
resolution_type: documentation_restructure
tags: [agents-md, harness, context-engineering, boundaries, token-conservation]
---

# Scope-Level Instruction Grouping Eliminates Leaf Rule Redundancy While Preserving Invariants

## Problem

A monorepo with many leaf packages easily accumulates per-package instruction files that restate build commands, export schemas, and compiler rules already verified deterministically by standard CI gates. However, wholesale deletion of leaf files drops non-automated architectural invariants (such as zero-Effect import boundaries or security constraints like HTML entity escaping in bundled reporters).

## Mechanism

Group package instructions at the natural scope level (`apps/AGENTS.md`, `packages/ignorers/AGENTS.md`, `packages/toolchain/AGENTS.md`) rather than creating a file in every leaf package directory:

1. **Delete Tautological Rules**: Omit rules that merely repeat what the compiler, package manifest, or linter enforces mechanically.
2. **Elevate Boundaries to Scope Level**: State cross-cutting architectural constraints (e.g. all packages in `packages/ignorers/` must have zero runtime dependencies on `effect`) at the directory scope root.
3. **Keep Root Minimal**: Restrict root instruction files to repository boundaries (read-only surfaces, human approval gates) and Definition of Done.

## Invariants

- Scope-level instruction files define family boundaries, not per-package command listings.
- Every rule stated in an instruction file must either map to an automated check or declare a human review boundary.
- Tautological rules already enforced by typechecks, linters, or build scripts must be deleted.
