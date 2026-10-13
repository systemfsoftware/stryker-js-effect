---
title: Keep JSON rest records out of the machine-stream schema
date: 2026-09-27
last_updated: 2026-10-12
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
(`Schema.fromJsonString(Schema.JsonObject)`) failed `check` on unrelated PRs.

The fault is in the parse, not in the keys, so fix the parse and keep every key
the schema admits. Refusing keys that need a JSON escape narrows the law's domain
to what the buggy parser reads correctly, so the round-trip law no longer covers
them.

The V8 fault sits on one path. When an object has a single outgoing map
transition for a key that ends in a backslash, the parser's fast path reads a
later escaped key on that map as the backslash key. Bare strings and objects built
with `Object.fromEntries` never take that path, and neither do index-like keys.
On Node 24.21 a probe primed a fresh map with a backslash key, then decoded a
second key after the same first key. It misread every one of the 250 decodes
whose second key needs an escape and none of the 150 whose key needs none, both
with plain `JSON.parse` and with a reviver (#306's description).

`ManifestDocument` (#306) therefore decodes JSON text in three steps:

1. It decodes the text once, unchanged, with `Schema.fromJsonString(Schema.JsonObject)`,
   and fails with that decode's own issue, so malformed and non-object text
   report what they did before.
2. It swaps every key token for its offset in the text, which needs no escape,
   and parses that.
3. It decodes each original key token as a bare JSON string and rebuilds every
   object through `Effect.forEach`, which keeps nesting depth off the JS call
   stack.

Duplicate keys keep `JSON.parse` semantics: the last value wins, at the first
key's position. The encoded side stays an annotated `Schema.String` (what
`Schema.fromJsonString` uses), so the generated `∀x_ManifestDocument_=x` and
`∀x_ManifestDocumentEnc_=x` laws keep drawing every key.

Write the exported schema as an `S.`/`Schema.` member chain, or as a `pipe(...)`
call that takes one as an argument. Schema discovery generates no laws for an
export written as `localSchema.pipe(...)`. Gate: `vitest --reporter=verbose`
lists the pair `∀x_<Name>_=x` and `∀x_<Name>Enc_=x` for every export.

### Regression rows and the seed replay

The failure depends on what the worker parsed before, so a row must create that
state itself. Each row of "A manifest keeps a key that needs a JSON escape after
a manifest with a key ending in a backslash was read" (feature "Reading e2e
fixture manifests") first reads a manifest whose key is new to the process,
followed by a backslash key. It then reads one with the same first key followed by
the escaped key, and expects the document back key for key. On main's
`Schema.fromJsonString` decode, every row whose key needs an escape fails. A row
whose second key only ends in a backslash passes even on main, so it is no
regression row.

Replay a CI failure with the short token
`CONFORMANCE_REPLAY='property=<p>;seed=<s>;runs=<n>'` and `-t '<law name>'`, so
that only that law runs. In a full-file run, the laws that run first change the
parser's transition state, and the token can pass on the faulty decode. #306's
`property=2276007449;seed=880152087;runs=100` with `-t 'ManifestDocument_'` is
refuted on main (attempt 63) and passes on the fix.

Code smell: `Schema.fromJsonString` over `Schema.Record(Schema.String, …)` or
`Schema.JsonObject` whose keys come from outside the repository, on a Node
without the V8 fix 93cd21e (nodejs/node#66542).
