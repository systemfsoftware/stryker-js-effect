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

const annotations = (object: string): string => `S.annotations(${object})`

const documentationOnlyObject = '{ identifier: "HexBytes", description: "hex", title: "Hex Bytes" }'
const singleIdentifierObject = '{ identifier: "HexBytes" }'
const quotedKeyObject = '{ "identifier": "HexBytes" }'
const mixedObject = '{ arbitrary: () => 1, identifier: "HexStringInput" }'
const descriptionBesideBehaviourObject = '{ description: "x", arbitrary: () => 1 }'
const behaviourOnlyObject = '{ arbitrary: () => 1 }'
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
      code: annotations(documentationOnlyObject),
      ignores: [{ text: documentationOnlyObject, reason: ANNOTATION_OBJECT_IGNORED }],
    },
    {
      name: 'the identifier value inside a documentation-only object',
      code: annotations(documentationOnlyObject),
      ignores: [{ text: '"HexBytes"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'the description value inside a documentation-only object',
      code: annotations(documentationOnlyObject),
      ignores: [{ text: '"hex"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'the title value inside a documentation-only object',
      code: annotations(documentationOnlyObject),
      ignores: [{ text: '"Hex Bytes"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'a documentation entry that shares its object with a generator',
      code: annotations(mixedObject),
      ignores: [{ text: '"HexStringInput"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'an `annotations` object holding one identifier entry',
      code: annotations(singleIdentifierObject),
      ignores: [{ text: singleIdentifierObject, reason: ANNOTATION_OBJECT_IGNORED }],
    },
    {
      name: 'the value of that single identifier entry',
      code: annotations(singleIdentifierObject),
      ignores: [{ text: '"HexBytes"', reason: ANNOTATION_TEXT_IGNORED }],
    },
    {
      name: 'an `annotations` object keyed by string literals',
      code: annotations(quotedKeyObject),
      ignores: [{ text: quotedKeyObject, reason: ANNOTATION_OBJECT_IGNORED }],
    },
    {
      name: 'a description entry beside an `arbitrary` generator',
      code: annotations(descriptionBesideBehaviourObject),
      ignores: [{ text: '"x"', reason: ANNOTATION_TEXT_IGNORED }],
    },
  ],
  kept: [
    {
      name: 'a documentation property consulted as the node itself stays live',
      code: annotations(singleIdentifierObject),
      keeps: ['identifier: "HexBytes"'],
    },
    {
      name: 'a string at the wrong argument slot of a `Symbol.for` call',
      code: 'Symbol.for("first", "second")',
      keeps: ['"second"'],
    },
    {
      name: 'a string and an object at wrong argument slots of a tagged factory',
      code: 'S.TaggedClass()("t", { a: 1 }, "extra", { b: 2 })',
      keeps: ['"extra"', '{ b: 2 }'],
    },
    {
      name: 'a string at the wrong argument slot of a `Schema.Class` call',
      code: 'Schema.Class("id", "extra")({})',
      keeps: ['"extra"'],
    },
    { name: 'a string at the wrong argument slot of a `Schema.brand` call', code: 'S.brand("a", "b")', keeps: ['"b"'] },
    {
      name: 'an arrow at the wrong argument slot of `S.optionalWith`',
      code: 'S.optionalWith(S.String, () => "x", () => "y")',
      keeps: ['() => "y"'],
    },
    {
      name: 'a documentation object and its value at the wrong argument slot of `S.annotations`',
      code: 'S.annotations({ identifier: "a" }, { identifier: "b" })',
      keeps: ['{ identifier: "b" }', '"b"'],
    },
    { name: 'a bare `TaggedClass` factory call keeps its tag and fields', code: bareTaggedCall },
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
      code: annotations(mixedObject),
      keeps: [mixedObject],
    },
    {
      name: 'the generator value in a mixed `annotations` object',
      code: annotations(mixedObject),
      keeps: ['() => 1'],
    },
    { name: 'an `annotations` object holding only a generator', code: annotations(behaviourOnlyObject) },
    { name: 'the generator value in a generator-only `annotations` object', code: annotations(behaviourOnlyObject) },
    { name: 'an empty `annotations` object, which has no documentation entry', code: 'S.annotations({})' },
    {
      name: 'an `annotations` object holding documentation beside a generator',
      code: annotations(descriptionBesideBehaviourObject),
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
    { name: 'a `Schema.Struct` call keeps its tag and fields; it is not a tagged factory', code: structCall },
    { name: 'an object expression at a `TaggedClass` tag slot', code: swappedCall },
    { name: 'an object expression at a `Symbol.for` argument slot', code: 'Symbol.for({})' },
    { name: 'a string that is not the `Symbol.for` argument', code: 'const d = "MyBrand"; Symbol.for(d)' },
    { name: 'a `Match.tag` argument, which is a runtime discriminator', code: 'Match.tag("a")' },
    { name: 'documentation under `S.filter` stays live, object and value', code: filterCall },
    { name: 'a documentation value whose enclosing call is absent', code: 'const o = { identifier: "x" }' },
    { name: 'a documentation value at the second argument of `S.annotations`', code: secondArgumentCall },
    {
      name: 'an `annotations` object whose documentation key is computed stays live, object and value',
      code: computedKeyCall,
    },
    {
      name: 'a mixed file with ordinary objects, calls, and no Schema factories keeps everything live',
      code: 'export function load(id: string): Record<string, unknown> {\n  return { id, other: call(id) }\n}',
    },
  ],
})
