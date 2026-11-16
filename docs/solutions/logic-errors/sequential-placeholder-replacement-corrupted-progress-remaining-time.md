---
title: Sequential placeholder replacement corrupted the progress remaining time
date: 2026-11-15
category: logic-errors
module: stryker-js
problem_type: logic_error
component: reporters
severity: medium
symptoms:
  - "The progress reporter prints its remaining-time estimate as '<1mc' instead of '<1m'."
root_cause: logic_error
resolution_type: code_fix
tags: [reporter, progress, formatting, placeholder, replace-all]
---

# Sequential placeholder replacement corrupted the progress remaining time

## Problem

The progress formatter substituted `:et` before `:etc`. Replacing the elapsed-time placeholder therefore also consumed the prefix of the remaining-time placeholder, leaving a stray `c` in user-visible output.

## Symptoms

- A known progress tick rendered `remaining: <1mc`.
- The defect survived byte-for-byte comparison with the old implementation because both implementations shared it.

## What Didn't Work

- **Differential equivalence as a correctness oracle.** Matching the previous implementation proves that a refactor preserved behavior, including its defects; it does not prove that the rendered text is right.
- **Layout properties alone.** A fixed-width progress bar and correct newline behavior can hold while a different field contains corrupted text.

## Solution

Substitute longer placeholder names before their prefixes:

```typescript
Object.entries(data)
  .sort(([left], [right]) => right.length - left.length)
  .reduce(
    (out, [key, value]) => out.replaceAll(`:${key}`, String(value)),
    printed,
  )
```

The exact known-output example asserts `remaining: <1m`, not merely the bar's shape.

## Why This Works

Sequential substring replacement is order-dependent whenever one placeholder is a prefix of another. Longest-key-first replacement consumes `:etc` as a whole before `:et` can match its prefix. The ordering rule covers every placeholder in the data map rather than special-casing this pair.

## Prevention

- Give every text template at least one exact known-output assertion; use layout and state properties as additional evidence, not substitutes.
- When placeholders share prefixes, either parse complete tokens or replace them longest-first.
- Treat a differential run as a regression check only. Add an independent expected output when the old behavior was never verified.

## Related Issues

- `docs/solutions/architecture-patterns/formatting-became-a-decision-because-a-cell-had-to-decide.md`
- `docs/solutions/architecture-patterns/a-decision-that-carries-rendered-text-puts-presentation-under-the-mutation-gate.md`
