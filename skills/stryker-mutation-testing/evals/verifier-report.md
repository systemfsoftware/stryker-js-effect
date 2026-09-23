# Verifier Report: Blind-Probe & Assertion Audit (WF7 Gate)

## Date: 2026-09-18

## Skill: `stryker-mutation-testing`

## Status: **CLEAN (Passed)**

---

### Audit Criteria & Methodology

Per `skill-creator` `WF7` and `references/eval-answer-leakage.md`:

1. **Blind Probe**: Evaluated whether the prompt alone leaks the required keywords/answer without the skill.
2. **Body-Anchored Needles**: Assertions must verify doctrine specific to `@systemfsoftware/stryker-js` (e.g. `import.meta.resolve`, `file:`, `isCi`, `testFiles`, ignorer pairings) that an uninstructed model would get wrong.
3. **Discriminator Capability**: Tested against standard model defaults (where baseline models hallucinate `@stryker-mutator/core` or bare package strings in `plugins: [...]`).

---

### Eval-by-Eval Verdicts

| ID | Eval Name                        | Leakage Risk                                                                                                              | Discriminator Status                   | Verdict   |
| -- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------- |
| 0  | `vitest-plugin-url`              | **Zero** — Prompt does not mention `import.meta.resolve` or `file:` URLs. Baseline models default to legacy string array. | Strong discriminator (+100pp expected) | **CLEAN** |
| 1  | `local-v8-ci-vitest-dual-engine` | **Zero** — Prompt mentions slow Vitest; does not name `vm`, `isCi`, or `testFiles`.                                       | Strong discriminator                   | **CLEAN** |
| 2  | `zero-plugin-command-runner`     | **Low** — Mentions custom script; tests whether agent knows zero-plugin `command` syntax in v5.                           | Solid discriminator                    | **CLEAN** |
| 3  | `mutate-exclusions`              | **Zero** — Prompt only shows bad `mutate: ['src/**/*.ts']`.                                                               | Quality gate                           | **CLEAN** |
| 4  | `effect-schema-ignorer-pairing`  | **Zero** — Prompt only mentions brand tags and schema titles surviving; does not name package or ignorer identifier.      | High discriminator                     | **CLEAN** |
| 5  | `decision-guide-routing`         | **Zero** — Open trade-off question testing reference load path.                                                           | Route verification                     | **CLEAN** |
| 6  | `negative-trigger-boundary`      | **Zero** — Pure Vitest coverage question; tests that skill does not hijack unrelated testing tasks.                       | Negative control                       | **CLEAN** |
| 7  | `messy-realistic-intro`          | **Zero** — Informal slang/backstory with zero keywords from description.                                                  | Activation verification                | **CLEAN** |

---

### Conclusion

All 8 evals (28 assertions) pass the WF7 gate. No answers are telegraphed in the prompts. All needle assertions are anchored to documented v5 invariants.
