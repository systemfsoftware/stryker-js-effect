import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ExtractModuleSpecifiersCommand,
  type ModuleSpecifiers,
  ModuleSpecifiersClosed,
  ModuleSpecifiersOpen,
  ModuleSpecifiersSchema,
} from './import-closure.schema.js'

interface ScanState {
  readonly specifiers: HashSet.HashSet<string>
  readonly hidden: boolean
}

const EMPTY_STATE: ScanState = { specifiers: HashSet.empty(), hidden: false }

const LITERAL_TYPES = HashSet.make('Literal', 'StringLiteral')
const VITEST_OBJECTS = HashSet.make('vi', 'vitest')
const MOCK_METHODS = HashSet.make('doMock', 'importActual', 'importMock', 'mock', 'unmock')

const isJsonObject = (value: S.Json): value is S.JsonObject => Predicate.isReadonlyObject(value)

const isJsonArray = (value: S.Json): value is S.JsonArray => Array.isArray(value)

const textOf = (value: S.Json): Option.Option<string> => Option.liftPredicate(value, Predicate.isString)

const fieldOf = (node: S.JsonObject, key: string): Option.Option<S.Json> => Option.fromUndefinedOr(node[key])

const hasTextType = (object: S.JsonObject): boolean => Option.isSome(Option.flatMap(fieldOf(object, 'type'), textOf))

const nodeOf = (value: S.Json | undefined): Option.Option<S.JsonObject> =>
  Option.filter(Option.filter(Option.fromUndefinedOr(value), isJsonObject), hasTextType)

const typeOf = (node: S.JsonObject): string => Option.getOrElse(Option.flatMap(fieldOf(node, 'type'), textOf), () => '')

const valuesOf = (value: S.Json): readonly S.Json[] =>
  Option.match(Option.liftPredicate(value, isJsonArray), { onNone: () => [value], onSome: (values) => values })

const childrenOf = (node: S.JsonObject): readonly S.Json[] => Object.values(node).flatMap(valuesOf)

const nameOf = (value: S.Json | undefined): Option.Option<string> =>
  Option.flatMap(nodeOf(value), (node) => Option.flatMap(fieldOf(node, 'name'), textOf))

const memberNameOf = (callee: S.Json | undefined, key: string): Option.Option<string> =>
  Option.flatMap(nodeOf(callee), (node) => nameOf(node[key]))

const unquotedOf = (raw: S.Json | undefined): Option.Option<string> =>
  Option.map(
    Option.filter(Option.flatMap(Option.fromUndefinedOr(raw), textOf), (text) => text.length >= 2),
    (text) => text.slice(1, -1),
  )

const textOrRawOf = (node: S.JsonObject): Option.Option<string> =>
  Option.orElse(Option.flatMap(fieldOf(node, 'value'), textOf), () => unquotedOf(node['raw']))

const literalTextOf = (node: S.JsonObject): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(node, (candidate) => HashSet.has(LITERAL_TYPES, typeOf(candidate))), textOrRawOf)

const withSpecifier = (state: ScanState, specifier: string): ScanState => ({
  ...state,
  specifiers: HashSet.add(state.specifiers, specifier),
})

const withSource = (state: ScanState, source: S.JsonObject): ScanState =>
  Option.match(literalTextOf(source), {
    onNone: () => ({ ...state, hidden: true }),
    onSome: (specifier) => withSpecifier(state, specifier),
  })

const sourceStep = (state: ScanState, source: S.Json | undefined): ScanState =>
  Option.match(nodeOf(source), { onNone: () => state, onSome: (node) => withSource(state, node) })

const declarationStep = (state: ScanState, node: S.JsonObject): ScanState => sourceStep(state, node['source'])

const isRequireCall = (node: S.JsonObject): boolean => Option.contains(nameOf(node['callee']), 'require')

const isMockCall = (node: S.JsonObject): boolean =>
  Boolean.and(
    Option.exists(memberNameOf(node['callee'], 'object'), (name) => HashSet.has(VITEST_OBJECTS, name)),
    Option.exists(memberNameOf(node['callee'], 'property'), (name) => HashSet.has(MOCK_METHODS, name)),
  )

const firstArgumentOf = (node: S.JsonObject): S.Json | undefined =>
  Option.match(fieldOf(node, 'arguments'), { onNone: () => undefined, onSome: (values) => valuesOf(values)[0] })

const callStep = (state: ScanState, node: S.JsonObject): ScanState =>
  Boolean.match(Boolean.or(isRequireCall(node), isMockCall(node)), {
    onTrue: () => sourceStep(state, firstArgumentOf(node)),
    onFalse: () => state,
  })

const STEPS: HashMap.HashMap<string, (state: ScanState, node: S.JsonObject) => ScanState> = HashMap.make(
  ['ExportAllDeclaration', declarationStep],
  ['ExportNamedDeclaration', declarationStep],
  ['ImportDeclaration', declarationStep],
  ['ImportExpression', declarationStep],
  ['CallExpression', callStep],
)

const nodeStep = (state: ScanState, node: S.JsonObject): ScanState =>
  Option.match(HashMap.get(STEPS, typeOf(node)), { onNone: () => state, onSome: (step) => step(state, node) })

const stepValue = (state: ScanState, value: S.Json): ScanState =>
  Option.match(nodeOf(value), { onNone: () => state, onSome: (node) => walk(state, node) })

const walk = (state: ScanState, node: S.JsonObject): ScanState =>
  childrenOf(node).reduce(stepValue, nodeStep(state, node))

const decisionOf = (state: ScanState): ModuleSpecifiers => {
  const specifiers = [...state.specifiers].sort()
  return Boolean.match(state.hidden, {
    onTrue: (): ModuleSpecifiers => ModuleSpecifiersOpen.make({ specifiers }),
    onFalse: (): ModuleSpecifiers => ModuleSpecifiersClosed.make({ specifiers }),
  })
}

const decide = (command: ExtractModuleSpecifiersCommand): Result.Result<ModuleSpecifiers, never> =>
  Result.succeed(decisionOf(stepValue(EMPTY_STATE, command.program)))

export const extractModuleSpecifiers = Workflow.make({
  command: ExtractModuleSpecifiersCommand,
  decision: ModuleSpecifiersSchema,
  error: S.Never,
  decide,
})
