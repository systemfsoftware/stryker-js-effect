---
title: A law that opens a tsgo session per run times out under CI load; compile each distinct input once
date: 2026-11-15
category: test-failures
module: stryker-js-typescript-checker
problem_type: test_failure
component: testing_framework
severity: medium
applies_when:
  - an in-source `it.prop` law builds a TypeScript program (tsgo `API`) inside its predicate
  - the law's inputs come from a small finite set, so most runs rebuild a program already built
  - a law passes locally but times out at vitest's 30 s limit on CI
retire_when: "no law in the checker builds a tsgo program inside a predicate, or the API exposes one long-lived session the laws can share"
tags: [property-test, tsgo, timeout, ci-load, in-source-tests]
---

# A law that opens a tsgo session per run times out under CI load

## Symptom

`∀w_EditSiteFactsOf_≡WideningNeverTurnsARefusalIntoAnAdmit` in `src/edit-site.schema.ts` failed the `check` job on main (run 43715844014, 31082 ms) and on a PR (run 43717228417, 31708 ms) with `Test timed out in 30000ms`. Locally it passed, and the whole file ran in 5 s.

## Cause

Every predicate run called `readFile`, which created a tsgo `API` (a spawned tsgo process), opened a project, read the source file and closed the session. Across the file's 13 laws, that was 181 sessions, measured with a probe, for only 35 distinct (file name, text) inputs: three function shapes, up to 12 trailing declarations, five extensions. Each session took about 25 ms on an idle machine. CI runs about 117 turbo tasks at once on the runner, so spawning a process each time cost far more, and the slowest law crossed 30 s.

## Fix

Compile each distinct input once, keyed by `[fileName, text]`. Every run then reads the cached `SourceFile`. Each compile still opens its own session on a virtual file system holding only that file, and closes it at once. A tsgo `SourceFile` stays readable after its session closes: every law reads its nodes after `close` and passes.

`afterAll` cannot close long-lived sessions here, because `in-source-test-prop-only` forbids any call but `it.prop` inside an `import.meta.vitest` block. Closing at once keeps the fix inside the rule.

Measured locally: the file went from 5.0 s to 1.2 s (three runs), with the same 13 laws passing and lint clean.

## Prevention

When a predicate needs a compiled program, ask whether its inputs repeat. With a finite input space, compile once per distinct input and keep the predicate pure over the result.
