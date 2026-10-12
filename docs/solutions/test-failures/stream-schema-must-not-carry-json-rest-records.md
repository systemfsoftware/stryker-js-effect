---
title: Keep JSON rest records out of the machine-stream schema
date: 2026-09-27
last_updated: 2026-10-11
category: test-failures
problem_type: flaky codec round-trip law caused by a V8 JSON.parse defect
input_shape: solution
subject: A generated wire line whose object keys carry escaped backslashes and lone surrogates decodes to different keys under V8 13.6 and 14.6 (Node 24 and 26), so a stream round-trip law over a schema with open JSON records fails on some seeds only
applies_when:
  - adding a field to a `RunEvent` schema in the CLI contract package
  - reusing a generated `Report` shape (a struct with a rest record of arbitrary JSON) inside a stream event
  - a `∀x_<Schema>_=x` law or a document parity scenario fails on CI and passes locally with a different seed
  - a schema decodes JSON text into a record keyed by `Schema.String`, `Schema.Json` or `Schema.JsonObject`
---

# Keep JSON rest records out of the machine-stream schema

## Problem

The `∀x_RunEventWireLine_=x` law in the CLI contract package failed on the
macOS and Ubuntu check jobs and passed on most local runs. The shrunk
counterexample was a `verdict` line whose `thresholds` and mutant locations
carried extra keys such as `"\\"` and `"\ud800"`. Those extra keys came from
the report shapes the verdict reused: `Report.Thresholds` and `Report.Location`
are structs with a rest record of arbitrary JSON, so the generator is free to
invent keys.

The line the codec wrote was correct. Parsing it back returned an object whose
last key read `\` instead of the lone surrogate. The same text parsed alone
returned the right keys, so the fault depends on what the parser read before.

## Failure mechanism

1. V8 keeps a cache of parsed object keys. After it parses a key that ends in an
   escaped backslash, a later escaped key in the same parse can decode to the
   cached key instead of its own text. This is
   [nodejs/node#63785](https://github.com/nodejs/node/issues/63785), still open.
   The version sweep on that issue (comment of 2026-08-21) found V8 13.6
   (Node 24.19.0) and V8 14.6 (Node 26.7.0) affected, each losing 5 of 36
   keys, and V8 12.4 (Node 22.23.2) and V8 11.3 (Node 20.20.2) correct. It
   places the regression somewhere between V8 12.4 and 13.6. A later comment
   (2026-10-05) reports it on Node 24.21.0 and 26.10.0 as well.
2. A schema with a rest record lets the property generator emit any key, so
   some seeds produce the poisoning key followed by the victim key.
3. The round-trip law compares the parsed value with the generated one, so the
   parser defect reads as a codec defect on those seeds only.

## Architectural Invariants

- **The stream states every field it carries.** Stream events use fixed-field
  structs (`RunEvent.VerdictThresholds`, `RunEvent.VerdictLocation`); a report
  shape with a rest record does not appear in a `RunEvent`. The committed
  `stream.schema.json` has no `additionalProperties` or
  `patternProperties` schema object.
- **A projection claims only what its source guarantees.** The verdict is built
  from any `Report.MutationTestResult`, whose upstream thresholds and locations
  carry no ordering, so the verdict structs carry no ordering either. Ordering
  stays on `Mutant.Location`, which the `mutant` line carries from the domain
  event.
- **Declarations sit behind a struct.** `Mutant.Location` and
  `Mutant.OpenEndLocation` decode from a plain struct into the ordered
  declaration. A bare `Schema.declare` renders as an empty JSON Schema, which
  would publish a document that admits anything at that field.

## Verification

- `contract-documents.integration.test.ts` in the CLI contract package
  regenerates the stream document from the wire codec and requires it to equal
  the committed bytes.
- Run the CLI contract package's suite under CI settings (`env -u AGENT CI=true
  vitest run`) several times; each run draws new seeds for the generated laws,
  which run in each schema's own module.
- Code smell: a `Report.*` schema, `Schema.Record(Schema.String, Schema.Json)`
  or `StructWithRest` referenced from `run-event.schema.ts`.

## Second case: String-keyed records in the e2e harness

The defect does not need a rest record: any record keyed by `Schema.String` lets
the generator draw the same keys. `∀x_ManifestDocument_=x` in the e2e-core package
(`Schema.fromJsonString(Schema.JsonObject)`) failed `check` on unrelated PRs, and
`∀x_NpmLockfileJson_=x` (a `packages` record keyed by `Schema.String`) shrank to a
`"\u0000"` key on #285. On Node 24.21 the law file failed 3 of 200 unpinned runs
while 20 runs of the whole e2e-core suite all passed (measured for #306, see its
description). Measure the law file on its own; suite runs hide the rate.

Every real key has a shape that needs no JSON escape, so the key schema refuses
the rest:

- Where the domain names its keys, use its pattern. Pending in #285: npm lock and
  manifest maps are keyed by npm package names, and `packages` by `""`,
  `node_modules/<name>` at any depth, or a workspace path, the shapes the seven
  committed fixture `package-lock.json` files hold.
- Where the record is a genuine pass-through (a fixture manifest that catalog
  resolution writes back), key it by the `PlainJsonKey` schema (#306). Remove it
  once CI's Node ships the V8 fix for nodejs/node#63785; the schema's comment
  names the commit.
- Check the key on the decoded side:
  `Schema.String.pipe(Schema.decodeTo(Schema.String.check(Schema.isPattern(re))))`.
  Gate: the refusal scenarios below, which fail when a bad key is skipped
  instead of refused at its path.
  - wrong: `Schema.Record(Schema.String.check(Schema.isPattern(re)), value)`
  - right: `Schema.Record(Schema.String.pipe(Schema.decodeTo(Schema.String.check(Schema.isPattern(re)))), value)`
- Write the escape class as `\p{Cc}\p{Cs}`. Gate: oxlint `no-control-regex`
  refuses a `\u0000-\u001F` range.
- In a recursive JSON union, define the object member once with its value
  behind `Schema.suspend`. Gate: the generated `∀s_<Name>Variants_⊇Declared`
  law fails on a record whose value is the bare union.
- Declare the object type as a type alias. Gate: `tsc` refuses an interface in
  `Record.get` (no `symbol` index), and oxlint `no-misused-spread` refuses its
  spread.

### Refusal tests replace seed replays

The regression is a refusal, not a round-trip. A document whose key is `\ud800`,
`\u0000`, or ends in an escaped backslash fails to decode, and the message names
the key path, such as `at ["packages"]["\u0000"]`. These are example rows, so
they go in a Gherkin `scenarioOutline` in the feature that already reads the
committed documents, next to one positive decode of every committed file:
the feature "Reading e2e fixture manifests" (#306), plus "Committed fixture
locks agree with the repository" (pending in #285). Keep them
out of `*.property.test.ts` files. Add no seed pin, reduced run budget or
arbitrary override; the generator follows the schema.

To compare a CI failure before and after a schema change, replay the short token
`CONFORMANCE_REPLAY='property=<p>;seed=<s>;runs=<n>'`. The full token also carries
a shrink `path` into the old generator's tree. After the schema changes, that
path reports `Shrunk input: undefined` and fails whatever the fix. #306's
replay of `property=2276007449;seed=880152087` is red before the fix and green
after it.

Code smell: `Schema.Record(Schema.String, …)` or `Schema.JsonObject` inside a
`Schema.fromJsonString` codec whose keys come from outside the repository.
