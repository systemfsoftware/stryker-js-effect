---
title: Read every report key exactly on Node 24, and refuse file keys no file can have - Plan
type: fix
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
supersedes: docs/plans/2026-10-13-0135-fix-report-json-exact-keys-plan.md
---

# Read every report key exactly on Node 24, and refuse file keys no file can have - Plan

## Goal Capsule

- **Objective:** `CountedReportJson` and `KillMatrixReportJson` decode every report key exactly on Node 24, whatever the process parsed before. A `files` key that no file can have (empty, or holding NUL) is refused with the existing typed refusal.
- **Authority:** root intent of 2026-10-12, "reopened main red after #306": `check` on main `ee7038a5c`, run 38305371777, failed `∀x_CountedReportJsonEnc_=x` (`packages/stryker-js/src/audit.schema.ts:312`).
- **Success:** both report codecs read an escaped key exactly after a parse of its backslash twin. Their generated laws are unchanged. `stryker audit` refuses a report with an empty or NUL `files` key, at that key's path.
- **Non-goals:** CI workflows, task scope, caches and turbo (so turbo-query-optimization does not apply). `Schema.fromJsonString` codecs outside `audit.schema.ts`. #306's e2e-core codec.

## Product Contract

### Problem Frame

On Node v24.21.0 (V8 13.6.233.17):

- The short replay `CONFORMANCE_REPLAY='property=3760492694;seed=3736416465;runs=100'` passes. The full token's shrink path reports `Shrunk input: undefined`, so neither token reproduces the failure.
- In a clean worker the codec round-trips the counterexample `{"files":{"":…,"\u0000":…,"\u0001":…}}`.
- After one `JSON.parse` of an object whose keys run `""`, `"\u0000"`, `"\\"`, the exact CI text decodes through `CountedReportJson` to keys `["", "\u0000", "\\"]`, reading `"\u0001"` as `"\\"`. That is nodejs/node#63785.
- Throwaway raw `JSON.parse` grids narrow the trigger. After an object with keys `L`, `P + "\"`, a later object with keys `L`, `P + c` reads `P + c` as `P + "\"`, where `c` is one character JSON must escape (a control character or `"`). Every misread observed has `P + c` as the object's last key. With a third key after it (`L`, `src/weird<TAB>`, `src/weird\`), the keys read correctly.

The codec's schema has no defect; Node misreads the keys. The V8 fix (v8/v8@93cd21e) waits in nodejs/node#66542, still open on 2026-10-13. No Node 24 release carries it.

Consumer impact is a renamed key, not lost counts. `stryker audit` decodes one report per `--projects` entry in one process, so a later report's `src/weird<TAB>` can come back as `src/weird\`. A two-project `--counts-only` smoke counted `a: 2, b: 3` on both main and the fix, since the colliding three-key shape reads correctly.

### Domain Ruling: Valid `files` Keys

A `files` key is the project-relative path of a mutated file.

| Key                      | Valid | Source                                                                                                                                                                                                                               |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `""`                     | No    | POSIX.1-2024 XBD 4.16: "A null pathname shall not be successfully resolved." The writer emits only `Mutant.CanonicalFileName` (`^[^\\]+$`), via `ReportFileNames` (`packages/stryker-js/src/reporting/report-assembly.schema.ts:8`). |
| contains NUL             | No    | POSIX.1-2024 XBD 3.146: a filename's bytes "shall not contain the <NUL> or <slash> characters". Node v24.21.0 refuses such a path: `ERR_INVALID_ARG_VALUE … without null bytes`.                                                     |
| U+0001-U+001F, backslash | Yes   | XBD 3.146 excludes only NUL and slash, so these name real files on Linux and macOS.                                                                                                                                                  |

The upstream `mutation-testing-report-schema` 3.7.2 declares no `propertyNames` for `files`, so this ruling is the product's own. `testFiles` and `costs` keys are not covered: upstream StrykerJS 10.0.0 writes `""` as the `testFiles` key for tests without a file (`normalizeReportFileName`, `src/reporters/mutation-test-report-helper.ts`).

### Requirements

- R1. Both report codecs decode every object key exactly, after any earlier parse in the process. The encoded side stays a JSON string.
- R2. A `files` key that is empty or holds NUL fails at that key's path, on decode and on encode, so `stryker audit` refuses the report with `matrix-undecodable`. The entry is never silently dropped.
- R3. Malformed text and valid JSON that is not a report fail with a decode issue, as they do on main.

### Acceptance Examples

- AE1 (R1). Each row parses `{L: 0, P + "\": 0}` with a fresh lead `L`, then decodes a report whose `files` keys are `L`, `P + c` through both codecs. Rows: `("", "\u0001")` (CI's case), `("src/weird", "\t")`, and drawn `(P, c)`. Each codec returns `[L, P + c]`. On main's codecs the law is refuted (shrunk input `["", "\""]`).
- AE2 (R2). `stryker audit --counts-only --projects a,b` where `b`'s report holds a `""` or `"src/a\u0000b.ts"` key: exit 2, `matrix-undecodable … at ["files"][""]` or `at ["files"]["src/a\u0000b.ts"]`. Main exits 0 and counts the entry.

### Scope Boundaries

- A separate PR from #306. Both use the same exact-key parse, but #306 fixes `ManifestDocument` in a private package that cannot import this package's source.
- One PR for R1 and R2. The shrunk counterexample is what put `""` and NUL keys in question, and both changes land on `files` in the same two codecs.

## Planning Contract

### Key Technical Decisions

- KTD1. Decode by key offset, in `audit.schema.ts`. The text is parsed once unchanged first, so malformed and non-object text keep their issue. Each key token is then replaced with its offset in the text, and the result is parsed. Each key token is decoded on its own as a bare JSON string. Objects are rebuilt through `Effect.forEach`, and the decode issue passes through unchanged. An object key with no matching key token fails the decode instead of keeping its offset as the key. Otherwise this is the decode #306 shipped after review.
- KTD2. Each export is `S.String.annotate(JSON_TEXT).pipe(S.decodeTo(S.Unknown, exactKeyJson), S.decodeTo(Report, SchemaTransformation.passthrough({ strict: false })))`. The report schema validates once, as `Schema.fromJsonString` does internally with its `Transformation<unknown, string>`. The chain stays `S.`-rooted, so schema discovery generates its laws.
- KTD3. Both `files` records keep `S.String` keys and carry one record-level check, `keyedByFilePath`, which returns `{ path: [key], issue }` for each bad key. A key schema cannot refuse in both directions. A refined key narrows which properties a `Record` selects ("Checks on string … key schemas narrow which properties are selected", `effect/Schema` `Record`), so it silently drops a bad entry. A key transformed from `S.String` refuses on decode, but encode selects by the refined type side and still drops the entry. A record check runs on both sides and points its issue at the key.

### Implementation Units

- U1. `packages/stryker-js/src/audit.schema.ts`: KTD1-KTD3, plus two in-source laws:
  - `∀k_ReportFilePathRefusal_≡BothReportsKeepExactlyTheNonEmptyKeysWithoutNul`: takes each drawn key, plus `""`, NUL, tab, backslash and plain boundaries, through both JSON codecs in both directions. A valid key reads back exactly and encodes; an invalid one is refused both ways. Its oracle is written independently of `keyedByFilePath`.
  - `∀p_ReportJsonKeys_≡ReadAnEscapedKeyExactlyAfterAParseOfItsBackslashTwin`: AE1.
- U2. A changeset: patch `@systemfsoftware/stryker-js`.
- U3. `packages/stryker-js/README.md` Known issues: `stryker audit` reads its reports' keys exactly; other report reads in the same process can still see a substituted key.

### Test Admission

| Test                                    | Layer                                          | Verdict                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated `∀x_*_=x` / `∀x_*Enc_=x` laws | Schema codec laws                              | Existing, unchanged                                                                                                                             |
| `ReportFilePath` refusal law            | Schema boundary (R2), through both codecs      | Admitted. It pins refuse-versus-skip in both directions, which both earlier KTD3 designs got wrong, and it kills a mutant that drops the check. |
| nodejs/node#63785 law                   | Known-bug regression, in-process               | Admitted. It is the only test that primes V8, and it is refuted on main's codecs.                                                               |
| CLI scenario for AE2                    | Spawns a process; same path as the refusal law | Refused. Run once as a throwaway smoke.                                                                                                         |

### Verification Contract

| Check                     | Command or source                                           | Done signal                               |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Regression red then green | U1's laws against main's codecs, then the fix               | refuted, then passes                      |
| Laws                      | `vitest run src/audit.schema.ts`, 200 unpinned runs         | 0 failures                                |
| CI token                  | the short replay over the full file                         | passes                                    |
| AE2 smoke                 | built CLI, main and fix                                     | main exit 0; fix exit 2 at the key's path |
| Gates                     | `tsc -b`, oxlint, effect-tsgo, dprint, the package suite    | exit 0                                    |
| Review                    | `ce-code-review`, report-only, served by a non-Claude model | every finding has a disposition           |
| CI                        | `run_watch` on the PR head                                  | required jobs green                       |

A refuted local run writes its seed to `src/__property_seeds__/<file>.jsonl`, and later runs replay that seed first. Delete any entry a deliberate red check wrote before measuring.

## Open Questions for the Supervisor

- Should one shared package own the exact-key decode after #306 lands? Every `Schema.fromJsonString` codec over a `Schema.String`-keyed record could then use it.
- Should `files` keys also refuse a backslash? The product's writer never emits one (`CanonicalFileName`), but POSIX allows it, so this plan admits it.
