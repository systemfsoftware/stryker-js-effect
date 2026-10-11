import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { extractModuleSpecifiers } from '../extract-module-specifiers.workflow.js'
import {
  ExtractModuleSpecifiersCommand,
  type ModuleSpecifiers,
  ModuleSpecifiersOpen,
} from '../import-closure.schema.js'
import {
  type Container,
  type DecoyForm,
  DrawnProgram,
  type DrawnSource,
  LiteralSource,
  RecognisedForm,
} from './module-specifier-cases.schema.js'

const identifier = (name: string): S.Json => ({ type: 'Identifier', name })

const memberOf = (object: string, property: string): S.Json => ({
  type: 'MemberExpression',
  object: identifier(object),
  property: identifier(property),
  computed: false,
})

const callOf = (callee: S.Json, args: readonly S.Json[]): S.Json => ({
  type: 'CallExpression',
  callee,
  arguments: args,
  optional: false,
})

const sourceNodeOf = (source: DrawnSource): S.Json =>
  Match.value(source).pipe(
    Match.tagsExhaustive({
      LiteralSource: ({ specifier, literalType, valueless }): S.Json => ({
        type: literalType,
        value: valueless ? null : specifier,
        raw: `'${specifier}'`,
      }),
      TemplateSource: ({ text, withExpression }): S.Json => ({
        type: 'TemplateLiteral',
        quasis: [{ type: 'TemplateElement', value: { raw: text, cooked: text }, tail: true }],
        expressions: withExpression ? [identifier('name')] : [],
      }),
      IdentifierSource: ({ name }) => identifier(name),
    }),
  )

const recognisedNodeOf = (form: RecognisedForm): S.Json => {
  const source = sourceNodeOf(form.source)
  return Match.value(form.kind).pipe(
    Match.when('ImportDeclaration', (type): S.Json => ({ type, specifiers: [], source, attributes: [] })),
    Match.when('ExportNamedDeclaration', (type): S.Json => ({ type, declaration: null, specifiers: [], source })),
    Match.when('ExportAllDeclaration', (type): S.Json => ({ type, exported: null, source, attributes: [] })),
    Match.when('ImportExpression', (type): S.Json => ({ type, source, options: null })),
    Match.when('require', () => callOf(identifier('require'), [source])),
    Match.when('vi', (object) => callOf(memberOf(object, form.method), [source])),
    Match.when('vitest', (object) => callOf(memberOf(object, form.method), [source])),
    Match.exhaustive,
  )
}

const decoyNodeOf = (decoy: DecoyForm): S.Json => {
  const source = sourceNodeOf(decoy.source)
  return Match.value(decoy.kind).pipe(
    Match.when('otherCall', () => callOf(identifier('load'), [source])),
    Match.when('otherVitestMethod', () => callOf(memberOf('vi', 'fn'), [source])),
    Match.when('memberRequire', () => callOf(memberOf('module', 'require'), [source])),
    Match.when('jestMock', () => callOf(memberOf('jest', 'mock'), [source])),
    Match.when('bareExport', (): S.Json => ({
      type: 'ExportNamedDeclaration',
      declaration: identifier('local'),
      specifiers: [],
      source: null,
    })),
    Match.when('argumentless', () => callOf(identifier('require'), [])),
    Match.exhaustive,
  )
}

const wrapped = (container: Container, inner: S.Json): S.Json =>
  container === 'array'
    ? { type: 'ArrayExpression', elements: [null, inner] }
    : {
      type: 'ArrowFunctionExpression',
      params: [],
      body: { type: 'BlockStatement', body: [{ type: 'ExpressionStatement', expression: inner }] },
    }

const nestedNodeOf = (form: RecognisedForm | DecoyForm): S.Json =>
  Array.from({ length: form.depth }).reduce<S.Json>(
    (inner) => wrapped(form.container, inner),
    Match.value(form).pipe(Match.tagsExhaustive({ RecognisedForm: recognisedNodeOf, DecoyForm: decoyNodeOf })),
  )

const commandOf = (drawn: DrawnProgram): ExtractModuleSpecifiersCommand =>
  ExtractModuleSpecifiersCommand.make({
    program: {
      type: 'Program',
      sourceType: 'module',
      body: drawn.map((form) => ({ type: 'ExpressionStatement', expression: nestedNodeOf(form) })),
      comments: [],
    },
  })

const recognisedOf = (drawn: DrawnProgram): readonly RecognisedForm[] => drawn.filter(S.is(RecognisedForm))

const literalSpecifiersOf = (drawn: DrawnProgram): readonly string[] =>
  [
    ...new Set(
      recognisedOf(drawn)
        .map((form) => form.source)
        .filter(S.is(LiteralSource))
        .map((source) => source.specifier),
    ),
  ].sort()

const holdsNonLiteralSource = (drawn: DrawnProgram): boolean =>
  recognisedOf(drawn).some((form) => !S.is(LiteralSource)(form.source))

type ExtractSubject = (command: ExtractModuleSpecifiersCommand) => Result.Result<ModuleSpecifiers, never>

const decisionOf = (subject: ExtractSubject, drawn: DrawnProgram): ModuleSpecifiers =>
  Result.getOrElse(subject(commandOf(drawn)), (unreachable: never) => unreachable)

describe('extractModuleSpecifiers', () => {
  it.prop(
    '∀p_Program_≡SpecifiersAreTheLiteralSourcesOfRecognisedForms',
    { of: [DrawnProgram], subject: extractModuleSpecifiers },
    (subject, [drawn]) => {
      const specifiers = decisionOf(subject, drawn).specifiers
      const expected = literalSpecifiersOf(drawn)
      return specifiers.length === expected.length &&
        specifiers.every((specifier, index) => specifier === expected[index])
    },
  )

  it.prop(
    '∀p_Program_≡OpenIffARecognisedFormHasANonLiteralSource',
    { of: [DrawnProgram], subject: extractModuleSpecifiers },
    (subject, [drawn]) => S.is(ModuleSpecifiersOpen)(decisionOf(subject, drawn)) === holdsNonLiteralSource(drawn),
  )
})
