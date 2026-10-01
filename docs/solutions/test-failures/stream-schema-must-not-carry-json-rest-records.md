---
title: Keep JSON rest records out of the machine-stream schema
date: 2026-09-27
category: test-failures
problem_type: flaky codec round-trip law caused by a V8 JSON.parse defect
input_shape: solution
subject: A generated wire line whose object keys carry escaped backslashes and lone surrogates decodes to different keys under V8 12.4 to 13.6, so a stream round-trip law over a schema with open JSON records fails on some seeds only
applies_when:
  - adding a field to a `RunEvent` schema in the CLI contract package
  - reusing a generated `Report` shape (a struct with a rest record of arbitrary JSON) inside a stream event
  - a `∀x_<Schema>_=x` law or a document parity scenario fails on CI and passes locally with a different seed
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
   [nodejs/node#63785](https://github.com/nodejs/node/issues/63785), open
   against V8 12.4 to 13.6 (Node 22 to 26).
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

- `stream-document.differential.test.ts` in the CLI contract package compares
  the committed document with the wire codec on lines generated from both, and
  requires them to refuse the same lines and reproduce the same JSON.
- Run the CLI contract package's suite under CI settings (`env -u AGENT CI=true
  vitest run`) several times; each run draws new seeds for the generated laws,
  which run in each schema's own module.
- Code smell: a `Report.*` schema, `Schema.Record(Schema.String, Schema.Json)`
  or `StructWithRest` referenced from `run-event.schema.ts`.
