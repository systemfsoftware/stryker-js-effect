import { describe, expect, it } from 'vitest'

import {
  ANNOTATION_OBJECT_IGNORED,
  ANNOTATION_TEXT_IGNORED,
  BRAND_NAME_IGNORED,
  CLASS_ID_IGNORED,
  OPTIONAL_DEFAULT_IGNORED,
  strykerIgnorers,
  SYMBOL_DESCRIPTION_IGNORED,
  TAGGED_FIELDS_IGNORED,
  TAGGED_TAG_IGNORED,
} from '@systemfsoftware/stryker-ignorer-effect-schema-declarations'
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'

const descriptor = strykerIgnorers[0]
if (descriptor === undefined) throw new Error('the package publishes one ignorer descriptor')

const documentationOnlyCall = 'S.annotations({ identifier: "HexBytes", description: "hex", title: "Hex Bytes" })'
const documentationOnlyObject = '{ identifier: "HexBytes", description: "hex", title: "Hex Bytes" }'
const singleIdentifierCall = 'S.annotations({ identifier: "HexBytes" })'
const singleIdentifierObject = '{ identifier: "HexBytes" }'
const quotedKeyCall = 'S.annotations({ "identifier": "HexBytes" })'
const quotedKeyObject = '{ "identifier": "HexBytes" }'
const mixedCall = 'S.annotations({ arbitrary: () => 1, identifier: "HexStringInput" })'
const mixedObject = '{ arbitrary: () => 1, identifier: "HexStringInput" }'
const descriptionBesideBehaviourCall = 'S.annotations({ description: "x", arbitrary: () => 1 })'
const descriptionBesideBehaviourObject = '{ description: "x", arbitrary: () => 1 }'
const behaviourOnlyCall = 'S.annotations({ arbitrary: () => 1 })'
const classCall = 'Schema.Class("ChildPolicyConfig")({})'
const taggedClassCall = 'S.TaggedClass()("myTag", {})'
const taggedErrorCall = 'S.TaggedError()("err", {})'
const bareTaggedCall = 'TaggedClass()("someTag", {})'
const structCall = 'Schema.Struct()("tag", {})'
const swappedCall = 'S.TaggedClass()({}, "tag")'
const computedKeyCall = 'S.annotations({ ["identifier"]: "x" })'
const filterCall = 'S.filter({ identifier: "x" })'
const displacedCall = 'S.annotations("other", { title: "Hex Bytes" })'
const secondArgumentCall = 'S.annotations("other", { identifier: "x" })'

describe('effect-schema-declarations', () => {
  it('Should_Register_The_Descriptor', () => {
    expect(descriptor.name).toBe('effect-schema-declarations')
  })
})

await testIgnorer(descriptor, {
  ignored: [
    {
      name: 'a `Symbol.for` description, which names a brand and carries no behaviour',
      code: 'Symbol.for("MyBrand")',
      ignores: [{ text: '"MyBrand"', reason: SYMBOL_DESCRIPTION_IGNORED }],
    },
    {
      name: 'a `TaggedClass` tag, which only labels the declaration',
      code: taggedClassCall,
      ignores: [{ text: '"myTag"', reason: TAGGED_TAG_IGNORED }],
    },
    {
      name: 'a `TaggedError` tag',
      code: taggedErrorCall,
      ignores: [{ text: '"err"', reason: TAGGED_TAG_IGNORED }],
    },
    {
      name: 'a `TaggedClass` fields object, whose schema declares rather than decides',
      code: taggedClassCall,
      ignores: [{ text: '{}', reason: TAGGED_FIELDS_IGNORED }],
    },
    {
      name: 'a `TaggedError` fields object',
      code: taggedErrorCall,
      ignores: [{ text: '{}', reason: TAGGED_FIELDS_IGNORED }],
    },
    {
      name: 'the arrow function `S.optionalWith` holds as a default',
      code: 'S.optionalWith(S.String, () => "x")',
      ignores: [{ text: '() => "x"', reason: OPTIONAL_DEFAULT_IGNORED }],
    },
    {
      name: 'the identifier of a `Schema.Class`, which rides the inner call',
      code: classCall,
      ignores: [{ text: '"ChildPolicyConfig"', reason: CLASS_ID_IGNORED }],
    },
    {
      name: 'a brand name, which is identity data like a description',
      code: 'Schema.brand("MaxChildren")',
      ignores: [{ text: '"MaxChildren"', reason: BRAND_NAME_IGNORED }],
    },
    {
      name: 'an `annotations` object whose every entry documents',
      code: documentationOnlyCall,
      ignores: [{ text: documentationOnlyObject, reason: ANNOTATION_OBJECT_IGNORED }],
    },
    {
      name: 'the identifier value inside a documentation-only object',
      code: documentationOnlyCall,
      ignores: [{ text: '"HexBytes"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'the description value inside a documentation-only object',
      code: documentationOnlyCall,
      ignores: [{ text: '"hex"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'the title value inside a documentation-only object',
      code: documentationOnlyCall,
      ignores: [{ text: '"Hex Bytes"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'a documentation entry that shares its object with a generator',
      code: mixedCall,
      ignores: [{ text: '"HexStringInput"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'an `annotations` object holding one identifier entry',
      code: singleIdentifierCall,
      ignores: [{ text: singleIdentifierObject, reason: ANNOTATION_OBJECT_IGNORED }],
    },
    {
      name: 'the value of that single identifier entry',
      code: singleIdentifierCall,
      ignores: [{ text: '"HexBytes"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'an `annotations` object keyed by string literals',
      code: quotedKeyCall,
      ignores: [{ text: quotedKeyObject, reason: ANNOTATION_OBJECT_IGNORED }],
    },
    {
      name: 'a description entry beside an `arbitrary` generator',
      code: descriptionBesideBehaviourCall,
      ignores: [{ text: '"x"', reason: ANNOTATION_TEXT_IGNORED }],
    },
  ],
  kept: [
    {
      name: 'a documentation property consulted as the node itself stays live',
      code: singleIdentifierCall,
      keeps: ['identifier: "HexBytes"'],
    },
    { name: 'a bare `TaggedClass` factory call keeps its tag', code: bareTaggedCall },
    { name: 'a bare `TaggedClass` factory call keeps its fields', code: bareTaggedCall },
    { name: 'a description in `Symbol.keyFor`, whose member is not `for`', code: 'Symbol.keyFor("desc")' },
    { name: 'a description in `Object.for`, whose object is not `Symbol`', code: 'Object.for("desc")' },
    { name: 'a description in `Symbol.iterator`, whose member name differs', code: 'Symbol.iterator("desc")' },
    { name: 'a string literal default under `S.optionalWith`, code', code: 'S.optionalWith(S.String, "x")' },
    {
      name: 'an arrow function default under `S.optional`, whose callee differs',
      code: 'S.optional(S.String, () => "x")',
    },
    {
      name: 'an `annotations` object mixing a generator with documentation',
      code: mixedCall,
      keeps: [mixedObject],
    },
    {
      name: 'the generator value in a mixed `annotations` object',
      code: mixedCall,
      keeps: ['() => 1'],
    },
    { name: 'an `annotations` object holding only a generator', code: behaviourOnlyCall },
    { name: 'the generator value in a generator-only `annotations` object', code: behaviourOnlyCall },
    { name: 'an empty `annotations` object, which has no documentation entry', code: 'S.annotations({})' },
    {
      name: 'an `annotations` object holding documentation beside a generator',
      code: descriptionBesideBehaviourCall,
      keeps: [descriptionBesideBehaviourObject],
    },
    { name: 'a documentation object at the second argument of `S.annotations`', code: displacedCall },
    { name: 'a documentation object under a bare `annotations` callee', code: 'annotations({ title: "Hex Bytes" })' },
    {
      name: 'a `Schema.Class` fields object, which carries accepted value sets',
      code: classCall,
      keeps: ['{}'],
    },
    { name: 'an accepted literal inside a `Schema.Literal` call', code: 'Schema.Literal("permanent", "transient")' },
    { name: 'a `Schema.Struct` tag, which is not a tagged factory', code: structCall },
    { name: 'a `Schema.Struct` fields object', code: structCall },
    { name: 'an object expression at a `TaggedClass` tag slot', code: swappedCall },
    { name: 'an object expression at a `Symbol.for` argument slot', code: 'Symbol.for({})' },
    { name: 'a string that is not the `Symbol.for` argument', code: 'const d = "MyBrand"; Symbol.for(d)' },
    { name: 'a `Match.tag` argument, which is a runtime discriminator', code: 'Match.tag("a")' },
    // Retired: 'an orphan identifier with no parent' — a real walk always roots at the
    // Program node, so a parentless consult is unreachable; no snippet can pin it.
    { name: 'a documentation object under `S.filter`', code: filterCall },
    { name: 'a documentation value under `S.filter`', code: filterCall },
    { name: 'a documentation value whose enclosing call is absent', code: 'const o = { identifier: "x" }' },
    { name: 'a documentation value at the second argument of `S.annotations`', code: secondArgumentCall },
    { name: 'an `annotations` object whose documentation key is computed', code: computedKeyCall },
    { name: 'the value under a computed documentation key', code: computedKeyCall },
    {
      name: 'a mixed file with ordinary objects, calls, and no Schema factories keeps everything live',
      code: 'export function load(id: string): Record<string, unknown> {\n  return { id, other: call(id) }\n}',
    },
  ],
})
