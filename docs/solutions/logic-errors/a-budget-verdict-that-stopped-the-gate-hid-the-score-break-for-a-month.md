---
title: A budget verdict that stopped the gate hid the score break for a month
date: 2026-11-15
category: logic-errors
module: stryker-js
problem_type: logic_error
component: gate
severity: high
applies_when:
  - a command judges several verdicts in sequence and stops at the first one that fails
  - a CI step downgrades one of those verdicts to a warning by matching its message
  - a verdict that is never reached still reads as passing in the job summary
retire_when: "the gate returns every verdict as data and the workflow decides from that data, not from a message match"
tags: [gate, budget, thresholds-break, ci, masking, mutation-score]
---

# A budget verdict that stopped the gate hid the score break for a month

## Symptom

The scheduled Mutation workflow's "Mutation report" job passed with a `BUDGET_EXCEEDED` warning, while every project scored below the shared `thresholds.break: 100`. The break verdict first appeared on main's run 43729437271. That run reused enough verdicts to stay in budget, and the gate reported `5 of 5 project(s) scored below thresholds.break`. The five scores were 55.01, 75.92, 67.68, 73.58 and 0.00.

## Cause

`gateReport` in `packages/stryker-js/src/run-request.cell.ts` judged three verdicts in sequence: new survivors against `--baseline`, then the budget, then the break. Each is a `VerdictFail` (exit 1), and the first failure ended the effect, so the verdicts after it were never judged. The workflow's gate step matched the budget message anywhere in the log and downgraded the exit to a warning. Together, a run that was over budget and below its break passed with only a warning.

Two integration scenarios pinned this sequencing as the contract: "fails on the budget before the break" and "A new survivor fails on the baseline verdict before the break is judged".

Unusable input (`GateInputUnusable`, `BudgetInputUnusable`) is a `ConfigError` (exit 2) and still stops the gate at once. That is intended: a gate that cannot read its inputs has no verdicts to judge.

## Fix

- The gate judges every verdict, prints each failing one once, and exits on the first in this order: the break, then new survivors, then the budget.
- The workflow downgrades only an exit line that names the budget breach. Since a run failing both exits on the break, the budget downgrade can no longer hide it.
- Two scenarios (budget and break; new survivor and break) require both verdicts printed and the exit on the break. Both fail on the old sequencing.

## Prevention

A gate that judges several verdicts judges all of them before it exits. A downgrade in CI matches the verdict the process exited on, not text anywhere in its output.
