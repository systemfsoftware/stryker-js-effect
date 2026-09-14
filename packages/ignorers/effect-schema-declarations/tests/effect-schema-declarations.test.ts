import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
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

import {
  annotationsCall,
  arrowFunction,
  bareFactoryCall,
  brandCall,
  callOf,
  classCall,
  identifier,
  memberOf,
  namedProperty,
  objectExpression,
  objectOf,
  propertyOf,
  stringLiteral,
  symbolForCall,
  taggedCall,
} from './__fixtures__/EffectSchemaAst.fixtures.js'

const brandDescription = stringLiteral('MyBrand')
const brandDescriptionCall = symbolForCall(brandDescription)

const keyForDescription = stringLiteral('desc')
const keyForCall = callOf(memberOf('Symbol', 'keyFor'), [keyForDescription])

const objectForDescription = stringLiteral('desc')
const objectForCall = callOf(memberOf('Object', 'for'), [objectForDescription])

const iteratorDescription = stringLiteral('desc')
const iteratorCall = callOf(memberOf('Symbol', 'iterator'), [iteratorDescription])

const unheldDescription = stringLiteral('MyBrand')
const otherDescription = stringLiteral('Other')
const unheldDescriptionCall = symbolForCall(otherDescription)

const objectAtSymbolFor = objectExpression()
const objectAtSymbolForCall = symbolForCall(objectAtSymbolFor)

const taggedTag = stringLiteral('myTag')
const taggedFields = objectExpression()
const taggedClassCall = taggedCall('TaggedClass', taggedTag, taggedFields)

const taggedErrorTag = stringLiteral('err')
const taggedErrorFields = objectExpression()
const taggedErrorCall = taggedCall('TaggedError', taggedErrorTag, taggedErrorFields)

const structTag = stringLiteral('tag')
const structFields = objectExpression()
const structCall = taggedCall('Struct', structTag, structFields)

const swappedFields = objectExpression()
const swappedTag = stringLiteral('tag')
const swappedCall = taggedCall('TaggedClass', swappedFields, swappedTag)

const bareTag = stringLiteral('someTag')
const bareFields = objectExpression()
const bareFactoryCallNode = bareFactoryCall('TaggedClass', bareTag, bareFields)

const classId = stringLiteral('ChildPolicyConfig')
const classFields = objectExpression()
const classOuterCall = classCall(classId, classFields)
const classInnerCall = classOuterCall.callee

const acceptedLiteralMember = stringLiteral('permanent')
const acceptedLiteralCall = callOf(memberOf('Schema', 'Literal'), [
  acceptedLiteralMember,
  stringLiteral('transient'),
])

const brandName = stringLiteral('MaxChildren')
const brandNameCall = brandCall(brandName)

const optionalDefault = arrowFunction()
const optionalSchema = memberOf('S', 'String')
const optionalWithCall = callOf(memberOf('S', 'optionalWith'), [optionalSchema, optionalDefault])
const stringDefault = stringLiteral('x')
const optionalWithStringCall = callOf(memberOf('S', 'optionalWith'), [optionalSchema, stringDefault])
const optionalCall = callOf(memberOf('S', 'optional'), [optionalSchema, optionalDefault])

const matchTag = stringLiteral('a')
const matchTagCall = callOf(memberOf('Match', 'tag'), [matchTag])

const orphanIdentifier = identifier('x')

const identifierEntry = namedProperty('identifier', stringLiteral('HexBytes'))
const descriptionEntry = namedProperty('description', stringLiteral('Uint8Array encoded as a lowercase hex string'))
const titleEntry = namedProperty('title', stringLiteral('Hex Bytes'))
const documentationOnly = objectOf([identifierEntry, descriptionEntry, titleEntry])
const documentationOnlyCall = annotationsCall(documentationOnly)

const singleIdentifierEntry = namedProperty('identifier', stringLiteral('HexBytes'))
const identifierOnly = objectOf([singleIdentifierEntry])
const identifierOnlyCall = annotationsCall(identifierOnly)

const quotedKeyObject = objectOf([propertyOf(stringLiteral('identifier'), stringLiteral('HexBytes'))])
const quotedKeyCall = annotationsCall(quotedKeyObject)

const computedKeyEntry = propertyOf(identifier('identifier'), stringLiteral('x'), true)
const computedKeyObject = objectOf([computedKeyEntry])
const computedKeyCall = annotationsCall(computedKeyObject)

const mixedBehaviourEntry = namedProperty('arbitrary', arrowFunction())
const mixedDocumentationEntry = namedProperty('identifier', stringLiteral('HexStringInput'))
const mixedAnnotations = objectOf([mixedBehaviourEntry, mixedDocumentationEntry])
const mixedAnnotationsCall = annotationsCall(mixedAnnotations)

const behaviourOnlyEntry = namedProperty('arbitrary', arrowFunction())
const behaviourOnlyObject = objectOf([behaviourOnlyEntry])
const behaviourOnlyCall = annotationsCall(behaviourOnlyObject)

const documentationBesideBehaviourEntry = namedProperty('description', stringLiteral('x'))
const behaviourBesideDocumentationEntry = namedProperty('arbitrary', arrowFunction())
const documentationAndBehaviour = objectOf([documentationBesideBehaviourEntry, behaviourBesideDocumentationEntry])
const documentationAndBehaviourCall = annotationsCall(documentationAndBehaviour)

const emptyAnnotations = objectOf([])
const emptyAnnotationsCall = annotationsCall(emptyAnnotations)

const displacedDocumentation = objectOf([namedProperty('title', stringLiteral('Hex Bytes'))])
const displacedDocumentationCall = callOf(memberOf('S', 'annotations'), [
  stringLiteral('other'),
  displacedDocumentation,
])

const bareCalleeDocumentation = objectOf([namedProperty('title', stringLiteral('Hex Bytes'))])
const bareCalleeCall = callOf(identifier('annotations'), [bareCalleeDocumentation])

const filteredDocumentationEntry = namedProperty('identifier', stringLiteral('x'))
const filteredDocumentation = objectOf([filteredDocumentationEntry])
const filteredDocumentationCall = callOf(memberOf('S', 'filter'), [filteredDocumentation])

const uncalledDocumentationEntry = namedProperty('identifier', stringLiteral('x'))
const uncalledDocumentation = objectOf([uncalledDocumentationEntry])

const secondArgumentDocumentationEntry = namedProperty('identifier', stringLiteral('x'))
const secondArgumentDocumentation = objectOf([secondArgumentDocumentationEntry])
const secondArgumentCall = callOf(memberOf('S', 'annotations'), [
  stringLiteral('other'),
  secondArgumentDocumentation,
])

const descriptor = strykerIgnorers[0]
if (descriptor === undefined) throw new Error('the package publishes one ignorer descriptor')

const CASES = {
  ignored: [
    {
      name: 'a `Symbol.for` description, which names a brand and carries no behaviour',
      path: { node: brandDescription, ancestors: [brandDescriptionCall] },
      reason: SYMBOL_DESCRIPTION_IGNORED,
    },
    {
      name: 'a `TaggedClass` tag, which only labels the declaration',
      path: { node: taggedTag, ancestors: [taggedClassCall] },
      reason: TAGGED_TAG_IGNORED,
    },
    {
      name: 'a `TaggedError` tag',
      path: { node: taggedErrorTag, ancestors: [taggedErrorCall] },
      reason: TAGGED_TAG_IGNORED,
    },
    {
      name: 'a `TaggedClass` fields object, whose schema declares rather than decides',
      path: { node: taggedFields, ancestors: [taggedClassCall] },
      reason: TAGGED_FIELDS_IGNORED,
    },
    {
      name: 'a `TaggedError` fields object',
      path: { node: taggedErrorFields, ancestors: [taggedErrorCall] },
      reason: TAGGED_FIELDS_IGNORED,
    },
    {
      name: 'the arrow function `S.optionalWith` holds as a default',
      path: { node: optionalDefault, ancestors: [optionalWithCall] },
      reason: OPTIONAL_DEFAULT_IGNORED,
    },
    {
      name: 'the identifier of a `Schema.Class`, which rides the inner call',
      path: { node: classId, ancestors: [classInnerCall] },
      reason: CLASS_ID_IGNORED,
    },
    {
      name: 'a brand name, which is identity data like a description',
      path: { node: brandName, ancestors: [brandNameCall] },
      reason: BRAND_NAME_IGNORED,
    },
    {
      name: 'an `annotations` object whose every entry documents',
      path: { node: documentationOnly, ancestors: [documentationOnlyCall] },
      reason: ANNOTATION_OBJECT_IGNORED,
    },
    {
      name: 'the identifier value inside a documentation-only object',
      path: { node: identifierEntry.value, ancestors: [identifierEntry, documentationOnly, documentationOnlyCall] },
      reason: ANNOTATION_TEXT_IGNORED,
    },
    {
      name: 'the description value inside a documentation-only object',
      path: { node: descriptionEntry.value, ancestors: [descriptionEntry, documentationOnly, documentationOnlyCall] },
      reason: ANNOTATION_TEXT_IGNORED,
    },
    {
      name: 'the title value inside a documentation-only object',
      path: { node: titleEntry.value, ancestors: [titleEntry, documentationOnly, documentationOnlyCall] },
      reason: ANNOTATION_TEXT_IGNORED,
    },
    {
      name: 'a documentation entry that shares its object with a generator',
      path: {
        node: mixedDocumentationEntry.value,
        ancestors: [mixedDocumentationEntry, mixedAnnotations, mixedAnnotationsCall],
      },
      reason: ANNOTATION_TEXT_IGNORED,
    },
    {
      name: 'an `annotations` object holding one identifier entry',
      path: { node: identifierOnly, ancestors: [identifierOnlyCall] },
      reason: ANNOTATION_OBJECT_IGNORED,
    },
    {
      name: 'the value of that single identifier entry',
      path: {
        node: singleIdentifierEntry.value,
        ancestors: [singleIdentifierEntry, identifierOnly, identifierOnlyCall],
      },
      reason: ANNOTATION_TEXT_IGNORED,
    },
    {
      name: 'an `annotations` object keyed by string literals',
      path: { node: quotedKeyObject, ancestors: [quotedKeyCall] },
      reason: ANNOTATION_OBJECT_IGNORED,
    },
    {
      name: 'a description entry beside an `arbitrary` generator',
      path: {
        node: documentationBesideBehaviourEntry.value,
        ancestors: [documentationBesideBehaviourEntry, documentationAndBehaviour, documentationAndBehaviourCall],
      },
      reason: ANNOTATION_TEXT_IGNORED,
    },
  ],
  kept: [
    {
      name: 'a documentation property consulted as the node itself stays live',
      path: { node: identifierEntry, ancestors: [documentationOnly, documentationOnlyCall] },
    },
    {
      name: 'a bare `TaggedClass` factory call keeps its tag',
      path: { node: bareTag, ancestors: [bareFactoryCallNode] },
    },
    {
      name: 'a bare `TaggedClass` factory call keeps its fields',
      path: { node: bareFields, ancestors: [bareFactoryCallNode] },
    },
    {
      name: 'a description in `Symbol.keyFor`, whose member is not `for`',
      path: { node: keyForDescription, ancestors: [keyForCall] },
    },
    {
      name: 'a description in `Object.for`, whose object is not `Symbol`',
      path: { node: objectForDescription, ancestors: [objectForCall] },
    },
    {
      name: 'a description in `Symbol.iterator`, whose member name differs',
      path: { node: iteratorDescription, ancestors: [iteratorCall] },
    },
    {
      name: 'a string literal default under `S.optionalWith`',
      path: { node: stringDefault, ancestors: [optionalWithStringCall] },
    },
    {
      name: 'an arrow function default under `S.optional`, whose callee differs',
      path: { node: optionalDefault, ancestors: [optionalCall] },
    },
    {
      name: 'an `annotations` object mixing a generator with documentation',
      path: { node: mixedAnnotations, ancestors: [mixedAnnotationsCall] },
    },
    {
      name: 'the generator value in a mixed `annotations` object',
      path: {
        node: mixedBehaviourEntry.value,
        ancestors: [mixedBehaviourEntry, mixedAnnotations, mixedAnnotationsCall],
      },
    },
    {
      name: 'an `annotations` object holding only a generator',
      path: { node: behaviourOnlyObject, ancestors: [behaviourOnlyCall] },
    },
    {
      name: 'the generator value in a generator-only `annotations` object',
      path: { node: behaviourOnlyEntry.value, ancestors: [behaviourOnlyEntry, behaviourOnlyObject, behaviourOnlyCall] },
    },
    {
      name: 'an empty `annotations` object, which has no documentation entry',
      path: { node: emptyAnnotations, ancestors: [emptyAnnotationsCall] },
    },
    {
      name: 'an `annotations` object holding documentation beside a generator',
      path: { node: documentationAndBehaviour, ancestors: [documentationAndBehaviourCall] },
    },
    {
      name: 'a documentation object at the second argument of `S.annotations`',
      path: { node: displacedDocumentation, ancestors: [displacedDocumentationCall] },
    },
    {
      name: 'a documentation object under a bare `annotations` callee',
      path: { node: bareCalleeDocumentation, ancestors: [bareCalleeCall] },
    },
    {
      name: 'a `Schema.Class` fields object, which carries accepted value sets',
      path: { node: classFields, ancestors: [classOuterCall] },
    },
    {
      name: 'an accepted literal inside a `Schema.Literal` call',
      path: { node: acceptedLiteralMember, ancestors: [acceptedLiteralCall] },
    },
    {
      name: 'a `Schema.Struct` tag, which is not a tagged factory',
      path: { node: structTag, ancestors: [structCall] },
    },
    {
      name: 'a `Schema.Struct` fields object',
      path: { node: structFields, ancestors: [structCall] },
    },
    {
      name: 'an object expression at a `TaggedClass` tag slot',
      path: { node: swappedFields, ancestors: [swappedCall] },
    },
    {
      name: 'an object expression at a `Symbol.for` argument slot',
      path: { node: objectAtSymbolFor, ancestors: [objectAtSymbolForCall] },
    },
    {
      name: 'a string that is not the `Symbol.for` argument',
      path: { node: unheldDescription, ancestors: [unheldDescriptionCall] },
    },
    {
      name: 'a `Match.tag` argument, which is a runtime discriminator',
      path: { node: matchTag, ancestors: [matchTagCall] },
    },
    {
      name: 'an orphan identifier with no parent',
      path: { node: orphanIdentifier },
    },
    {
      name: 'a documentation object under `S.filter`',
      path: { node: filteredDocumentation, ancestors: [filteredDocumentationCall] },
    },
    {
      name: 'a documentation value under `S.filter`',
      path: {
        node: filteredDocumentationEntry.value,
        ancestors: [filteredDocumentationEntry, filteredDocumentation, filteredDocumentationCall],
      },
    },
    {
      name: 'a documentation value whose enclosing call is absent',
      path: { node: uncalledDocumentationEntry.value, ancestors: [uncalledDocumentationEntry, uncalledDocumentation] },
    },
    {
      name: 'a documentation value at the second argument of `S.annotations`',
      path: {
        node: secondArgumentDocumentationEntry.value,
        ancestors: [secondArgumentDocumentationEntry, secondArgumentDocumentation, secondArgumentCall],
      },
    },
    {
      name: 'an `annotations` object whose documentation key is computed',
      path: { node: computedKeyObject, ancestors: [computedKeyCall] },
    },
    {
      name: 'the value under a computed documentation key',
      path: { node: computedKeyEntry.value, ancestors: [computedKeyEntry, computedKeyObject, computedKeyCall] },
    },
  ],
}

interface CasePath {
  readonly node: Node
  readonly ancestors?: readonly Node[] | undefined
}

const pathOf = (spec: CasePath): [node: Node, ancestors: readonly Node[]] => [spec.node, spec.ancestors ?? []]

describe('effect-schema-declarations', () => {
  it('Should_Register_The_Descriptor', () => {
    expect(descriptor.name).toBe('effect-schema-declarations')
  })
  it.each(CASES.ignored)('ignores: $name', (testCase) => {
    expect(descriptor.shouldIgnore(...pathOf(testCase.path))).toBe(testCase.reason)
  })
  it.each(CASES.kept)('keeps: $name', (testCase) => {
    expect(descriptor.shouldIgnore(...pathOf(testCase.path))).toBeUndefined()
  })
})
