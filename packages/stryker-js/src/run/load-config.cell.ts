import type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { isGlob } from '../glob-match.js'

import {
  ConfigDocumentSchema,
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
  ExtendsStepDone,
  ExtendsStepRead,
  ExtendsStepRefused,
  ExtendsStepResolve,
  forkOptionsSchema,
  ImportedModuleSchema,
} from '../Config.schema.js'
import type { ExtendsStepDecision, ExtendsStepDocument, ExtendsStepState } from '../Config.schema.js'
import { mergeConfig } from '../config/merge-config.js'
import type { ConfigEnv } from '../config/stryker-config.js'
import type { OutputMode } from '../output-mode.js'
import { MUTATION_RANGE_REGEX } from '../Project.ignore.js'
import { StrykerError } from '../stryker-error.schema.js'
import { isCommandRunner } from '../TestRunner.js'

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isRecordValue = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

export const optionsPath = (...path: string[]): string => path.join('.')

const combine = (
  prefixes: string[],
  suffixes: string[],
  extensions: string[],
): string[] =>
  prefixes.flatMap((prefix) =>
    suffixes.flatMap((suffix) => extensions.map((extension) => `${prefix}stryker${suffix}.${extension}`))
  )

const CONFIG_FILE_NAME_PREFIXES: readonly string[] = ['', '.']
const CONFIG_FILE_NAME_SUFFIXES: readonly string[] = ['.conf', '.config']
const SUPPORTED_CONFIG_FILE_EXTENSIONS: readonly string[] = ['ts', 'mts', 'js', 'mjs']
const LEGACY_CONFIG_FILE_EXTENSIONS: readonly string[] = ['json', 'cjs']

const configFileNames = (extensions: readonly string[]): readonly string[] =>
  combine(
    [...CONFIG_FILE_NAME_PREFIXES],
    [...CONFIG_FILE_NAME_SUFFIXES],
    [...extensions],
  )

export const SUPPORTED_CONFIG_FILE_NAMES = Object.freeze(configFileNames(SUPPORTED_CONFIG_FILE_EXTENSIONS))

const LEGACY_CONFIG_FILE_NAMES = Object.freeze(configFileNames(LEGACY_CONFIG_FILE_EXTENSIONS))

const SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE = `one of these extensions: ${
  SUPPORTED_CONFIG_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(', ')
}`

const legacyConfigHint = (file: string): string =>
  `Stryker no longer reads JSON or CommonJS config files. Convert "${file}" to a config module with an "export default { ... }" object — Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE} — and delete the legacy file.`

const unsupportedConfigHint = (file: string): string =>
  `"${file}" is not a supported config file. Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE}, for example "stryker.config.ts" with an "export default { ... }" object.`

const extendsChildHint = (file: string): string =>
  `The extended config "${file}" is a JSON or CommonJS config file, which Stryker no longer reads. Convert it to a config module — Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE} — and point "extends" at the converted file.`

const shadowedLegacyWarning = (legacyFile: string, supportedFile: string): string =>
  `Ignoring the legacy config file "${legacyFile}": "${supportedFile}" is the config Stryker reads. Stryker no longer reads JSON or CommonJS config files; delete the legacy file.`

export type Primitive = boolean | number | string | null | undefined

export type ImmutablePrimitive = Primitive | ((...args: never[]) => void)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

const isArrayValue = <A = unknown>(value: unknown): value is readonly A[] => Array.isArray(value)

const isMapValue = <K = unknown, V = unknown>(value: unknown): value is Map<K, V> => value instanceof Map

const isSetValue = <A = unknown>(value: unknown): value is Set<A> => value instanceof Set

const freezeArrayValue = <A = unknown>(value: readonly A[]): ReadonlyArray<Immutable<A>> =>
  Object.freeze(value.map((element) => deepFreeze(element)))

const freezeMapEntry = <K = unknown, V = unknown>(
  [entryKey, entryValue]: readonly [K, V],
): readonly [Immutable<K>, Immutable<V>] => [deepFreeze(entryKey), deepFreeze(entryValue)]

const freezeMapValue = <K = unknown, V = unknown>(value: Map<K, V>): ReadonlyMap<Immutable<K>, Immutable<V>> =>
  Object.freeze(new Map([...value.entries()].map(freezeMapEntry)))

const freezeSetValue = <A = unknown>(value: Set<A>): ReadonlySet<Immutable<A>> =>
  Object.freeze(new Set([...value.values()].map((element) => deepFreeze(element))))

const freezeRegExpValue = (value: RegExp): RegExp => Object.freeze(value)

const freezeRecordValue = <A = unknown>(value: Record<string, A>): Record<string, Immutable<A>> =>
  Object.freeze(
    Object.entries(value).reduce<Record<string, Immutable<A>>>((frozen, [property, propertyValue]) => {
      frozen[property] = deepFreeze(propertyValue)
      return frozen
    }, {}),
  )

export function deepFreeze<T>(target: T): Immutable<T>
export function deepFreeze(target: object | Primitive): object | Primitive {
  return Match.value(target).pipe(
    Match.when(isArrayValue, freezeArrayValue),
    Match.when(isMapValue, freezeMapValue),
    Match.when((value: unknown): value is RegExp => value instanceof RegExp, freezeRegExpValue),
    Match.when(isSetValue, freezeSetValue),
    Match.when(isRecordValue, freezeRecordValue),
    Match.orElse(() => target),
  )
}

export interface UnserializableDescription {
  path: string[]
  reason: string
}

const scopedUnserializable =
  (scope: string) => (description: UnserializableDescription): UnserializableDescription => ({
    ...description,
    path: [scope, ...description.path],
  })

const describeUnserializableChild = <A = unknown>(
  child: A,
  scope: string,
): UnserializableDescription[] =>
  Match.value(findUnserializables(child)).pipe(
    Match.when(undefined, (): UnserializableDescription[] => []),
    Match.orElse((descriptions) => descriptions.map(scopedUnserializable(scope))),
  )

const collectUnserializables = (
  groups: readonly (readonly UnserializableDescription[])[],
): UnserializableDescription[] | undefined => {
  const found = groups.flat()
  if (found.length > 0) return found
  return undefined
}

const describeUnserializableArray = <A = unknown>(
  value: readonly A[],
): UnserializableDescription[] | undefined =>
  collectUnserializables(
    value.map((child, index) => describeUnserializableChild(child, index.toString())),
  )

const describeUnserializableRecord = (
  value: object,
): UnserializableDescription[] | undefined =>
  collectUnserializables(
    Object.entries(value).map(([key, child]) => describeUnserializableChild(child, key)),
  )

const isPlainObjectValue = (value: object): boolean => !Array.isArray(value) && value.constructor === Object

const classNameOf = (value: object): string =>
  Match.value(value.constructor).pipe(
    Match.when(Match.defined, (ctor) => ctor.name),
    Match.orElse(() => 'Object'),
  )
const describeUnserializableInstance = (
  value: object,
): UnserializableDescription[] | undefined => [
  {
    path: [],
    reason: `Value is an instance of "${
      classNameOf(value)
    }", this detail will get lost in translation during serialization`,
  },
]

const describeUnserializableObject = (
  value: object,
): UnserializableDescription[] | undefined =>
  Match.value(value).pipe(
    Match.when(isArrayValue, describeUnserializableArray),
    Match.when(isPlainObjectValue, describeUnserializableRecord),
    Match.orElse(describeUnserializableInstance),
  )

const NON_JSON_PRIMITIVE_TYPES: readonly string[] = ['bigint', 'function', 'symbol']

const isNonJsonPrimitive = (
  value: unknown,
): value is bigint | symbol | ((...args: never[]) => void) => NON_JSON_PRIMITIVE_TYPES.includes(typeof value)

const describeNonJsonPrimitive = (
  value: bigint | symbol | ((...args: never[]) => void),
): UnserializableDescription[] | undefined => [
  {
    path: [],
    reason: `Primitive type "${typeof value}" has no JSON representation`,
  },
]

const describeNumber = (value: number): UnserializableDescription[] | undefined => {
  if (isFinite(value)) return undefined
  return [
    {
      reason: `Number value \`${value}\` has no JSON representation`,
      path: [],
    },
  ]
}

export function findUnserializables<A = unknown>(
  thing: A,
): UnserializableDescription[] | undefined {
  if (typeof thing === 'number') {
    return describeNumber(thing)
  }
  return describeNonNumberValue(thing)
}

function describeNonNumberValue<A = unknown>(
  thing: A,
): UnserializableDescription[] | undefined {
  return isNonJsonPrimitive(thing) ? describeNonJsonPrimitive(thing) : describeObjectValue(thing)
}

function describeObjectValue<A = unknown>(
  thing: A,
): UnserializableDescription[] | undefined {
  return isNonNullObject(thing) ? describeUnserializableObject(thing) : undefined
}

export type KnownKeys<T> = keyof {
  [P in keyof T as string extends P ? never : number extends P ? never : P]: T[P]
}

export type WarningOptions = Exclude<StrykerOptions['warnings'], boolean>

export function isWarningEnabled(
  warningType: KnownKeys<WarningOptions>,
  warningOptions: WarningOptions | boolean,
): boolean {
  if (typeof warningOptions === 'boolean') {
    return warningOptions
  } else {
    return warningOptions[warningType] === true
  }
}

const PATH_LINE = /^at\s+(\[.*\])$/
const PATH_SEGMENT = /\["([^"]*)"\]|\[(\d+)\]/g
const EXPECTED_PATTERN = /^Expected a string matching the RegExp (.+)$/
const EXPECTED_TYPE = /^Expected (.+)$/

const appendPathSegment = (path: string, segment: RegExpMatchArray): string =>
  Match.value(segment[2]).pipe(
    Match.when(undefined, () => appendKeySegment(path, segment[1] ?? '')),
    Match.orElse((index) => `${path}[${index}]`),
  )

const appendKeySegment = (path: string, key: string): string =>
  Match.value(path.length > 0).pipe(
    Match.when(true, () => `${path}.${key}`),
    Match.orElse(() => `${path}${key}`),
  )

const dottedPath = (raw: string): string => Array.from(raw.matchAll(PATH_SEGMENT)).reduce(appendPathSegment, '')

const phraseExpectedType = (expectation: string): string =>
  Match.value(EXPECTED_TYPE.exec(expectation)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => `should be ${match[1] ?? ''}`,
    ),
    Match.orElse(() => expectation),
  )

const phrase = (expectation: string): string =>
  Match.value(EXPECTED_PATTERN.exec(expectation)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => `must match pattern "${match[1] ?? ''}"`,
    ),
    Match.orElse(() => phraseExpectedType(expectation)),
  )

interface ErrorDescriptionState {
  readonly messages: readonly string[]
  readonly expectation: string | undefined
}

const EMPTY_ERROR_DESCRIPTION_STATE: ErrorDescriptionState = {
  messages: [],
  expectation: undefined,
}

const isBlankLine = (line: string): boolean => line.length === 0

const startExpectation = (state: ErrorDescriptionState, line: string): ErrorDescriptionState =>
  Match.value(state.expectation).pipe(
    Match.when(undefined, () => ({ messages: state.messages, expectation: line })),
    Match.orElse((pending) => ({ messages: [...state.messages, pending], expectation: line })),
  )

const completeExpectation = (
  state: ErrorDescriptionState,
  pathText: string,
  line: string,
): ErrorDescriptionState =>
  Match.value(state.expectation).pipe(
    Match.when(undefined, () => startExpectation(state, line)),
    Match.orElse((pending) => ({
      messages: [...state.messages, `Config option "${dottedPath(pathText)}" ${phrase(pending)}.`],
      expectation: undefined,
    })),
  )

const applyErrorLine = (state: ErrorDescriptionState, line: string): ErrorDescriptionState =>
  Match.value(PATH_LINE.exec(line)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => completeExpectation(state, match[1] ?? '', line),
    ),
    Match.orElse(() => startExpectation(state, line)),
  )

const advanceErrorDescription = (
  state: ErrorDescriptionState,
  rawLine: string,
): ErrorDescriptionState =>
  Match.value(rawLine.trim()).pipe(
    Match.when(isBlankLine, () => state),
    Match.orElse((line) => applyErrorLine(state, line)),
  )

const completedErrorMessages = (state: ErrorDescriptionState): readonly string[] =>
  Match.value(state.expectation).pipe(
    Match.when(undefined, () => state.messages),
    Match.orElse((pending) => [...state.messages, pending]),
  )

const errorMessageOrFallback = (messages: readonly string[], fallback: string): string[] =>
  Match.value(messages.length > 0).pipe(
    Match.when(true, () => [...messages]),
    Match.orElse(() => [fallback]),
  )

export function describeErrors(error: S.SchemaError): string[] {
  const state = error.message
    .split('\n')
    .reduce(advanceErrorDescription, EMPTY_ERROR_DESCRIPTION_STATE)
  return errorMessageOrFallback(completedErrorMessages(state), error.message)
}

export function importModule<A = unknown>(
  moduleName: string,
): Effect.Effect<A, StrykerError> {
  return Effect.tryPromise({
    try: (): Promise<A> => import(moduleName),
    catch: (cause) => StrykerError.make({ message: `Failed to import module "${moduleName}"`, cause }),
  })
}

export type { ExtendsStepDecision, ExtendsStepDocument, ExtendsStepState } from '../Config.schema.js'

export const initialExtendsStepState: ExtendsStepState = {
  visited: [],
  documents: [],
}

const asUnknownArray = <A = unknown>(value: A): readonly A[] => {
  if (Array.isArray(value)) return value
  return []
}

const isFirstDescriptorOccurrence =
  <A = unknown>(descriptors: readonly A[]) => (descriptor: A, index: number): boolean =>
    typeof descriptor !== 'string' || descriptors.slice(0, index).includes(descriptor) === false

const mergePluginDescriptors = <A = unknown>(
  parentPlugins: readonly A[],
  childPlugins: readonly A[],
): readonly A[] => {
  const merged = [...parentPlugins, ...childPlugins]
  return merged.filter(isFirstDescriptorOccurrence(merged))
}

const isConfigOptionsRecord = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

function mergeConfigRecords<A = unknown>(
  parentNested: Record<string, A>,
  childNested: Record<string, A>,
): Record<string, A> {
  return { ...parentNested, ...childNested }
}

const toConfigRecordOption = <A = unknown>(value: A): Option.Option<Record<string, A>> =>
  isConfigOptionsRecord<A>(value) ? Option.some(value) : Option.none()

const inheritNested = <A = unknown>(parentValue: A, childValue: A): A | Record<string, A> =>
  Option.match(Option.all([toConfigRecordOption(parentValue), toConfigRecordOption(childValue)]), {
    onSome: ([parentNested, childNested]) => mergeConfigRecords(parentNested, childNested),
    onNone: () => childValue,
  })

type ConfigOptionValue = PartialStrykerOptions extends Record<string, infer OptionValue> ? OptionValue : never

const inheritEntry = (
  out: PartialStrykerOptions,
  key: string,
  parentValue: ConfigOptionValue,
  childValue: ConfigOptionValue,
): PartialStrykerOptions =>
  Match.value(childValue).pipe(
    Match.when(null, () => {
      const next = { ...out }
      delete next[key]
      return next
    }),
    Match.orElse(() =>
      Match.value(key).pipe(
        Match.when(
          'plugins',
          () => ({
            ...out,
            [key]: mergePluginDescriptors(asUnknownArray(parentValue), asUnknownArray(childValue)),
          }),
        ),
        Match.orElse(() => ({ ...out, [key]: inheritNested(parentValue, childValue) })),
      )
    ),
  )

export function mergeConfigs(
  parent: PartialStrykerOptions,
  child: PartialStrykerOptions,
): PartialStrykerOptions {
  return Object.entries(child).reduce(
    (out, entry) => inheritEntry(out, entry[0], parent[entry[0]], entry[1]),
    { ...parent },
  )
}

const RELATIVE_SPECIFIER_PREFIXES: readonly string[] = ['./', '../', '/', '\\']

export function isModuleSpecifier(value: string): boolean {
  return RELATIVE_SPECIFIER_PREFIXES.every((prefix) => value.startsWith(prefix) === false)
}

const stripExtends = (document: PartialStrykerOptions): PartialStrykerOptions => {
  const { extends: _ignored, ...rest } = document
  return rest
}

const mergeChainDocuments = (documents: readonly ExtendsStepDocument[]): PartialStrykerOptions =>
  documents.reduceRight<PartialStrykerOptions>(
    (merged, entry) => mergeConfigs(merged, stripExtends(entry.options)),
    {},
  )

export const decideExtendsStep = (
  state: ExtendsStepState,
  document: PartialStrykerOptions,
  file: string,
  pathService: Path.Path,
): ExtendsStepDecision => {
  if (state.visited.includes(file)) {
    return ExtendsStepRefused.make({ reason: 'cycle', file })
  }
  const nextState: ExtendsStepState = {
    visited: [...state.visited, file],
    documents: [...state.documents, { path: file, options: document }],
  }
  return Match.value(document['extends']).pipe(
    Match.when(
      undefined,
      (): ExtendsStepDecision => ExtendsStepDone.make({ options: mergeChainDocuments(nextState.documents) }),
    ),
    Match.when(
      null,
      (): ExtendsStepDecision => ExtendsStepDone.make({ options: mergeChainDocuments(nextState.documents) }),
    ),
    Match.when(Match.string, (extendValue) =>
      Match.value(isModuleSpecifier(extendValue)).pipe(
        Match.when(true, (): ExtendsStepDecision =>
          ExtendsStepResolve.make({ specifier: extendValue, state: nextState })),
        Match.when(false, (): ExtendsStepDecision =>
          ExtendsStepRead.make({
            path: pathService.resolve(pathService.dirname(file), extendValue),
            state: nextState,
          })),
        Match.exhaustive,
      )),
    Match.orElse((): ExtendsStepDecision => ExtendsStepRefused.make({ reason: 'non-string-extends', file })),
  )
}

const decodeConfigDocument = <A = unknown>(
  configFile: string,
  document: A,
): Effect.Effect<PartialStrykerOptions, ConfigFileInvalidError> =>
  S.decodeUnknownEffect(ConfigDocumentSchema)(document).pipe(
    Effect.mapError((cause) => ConfigFileInvalidError.make({ file: configFile, cause })),
  )

const failInvalidConfig = (configFile: string, cause: string): Effect.Effect<object, ConfigFileInvalidError> =>
  Effect.fail(ConfigFileInvalidError.make({ file: configFile, cause }))

const requireDefaultExport = <A = unknown>(
  configFile: string,
  defaultExport: A,
): Effect.Effect<object, ConfigFileInvalidError> =>
  defaultExport === undefined
    ? failInvalidConfig(configFile, 'Config file must have a default export!')
    : settleObjectExport(configFile, defaultExport)

function settleObjectExport<A = unknown>(
  configFile: string,
  value: A,
): Effect.Effect<object, ConfigFileInvalidError> {
  return isNonNullObject(value)
    ? Effect.succeed(value)
    : failInvalidConfig(configFile, 'Default export of config file must be an object!')
}

type ConfigFactory<A = unknown> = (env: ConfigEnv) => A

const isConfigFactory = (value: unknown): value is ConfigFactory => typeof value === 'function'

function wrappedFactoryFailure(error: Error): Error {
  return new Error(`Evaluating the config module's exported factory failed: ${error.message}`, { cause: error })
}

const factoryFailureCause = <A = unknown>(cause: A): A | Error =>
  cause instanceof Error ? wrappedFactoryFailure(cause) : cause

const applyConfigFactory = <A = unknown>(factory: ConfigFactory<A>, configEnv: ConfigEnv): A => factory(configEnv)

/**
 * Settle a config module's default export into the object the document schema decodes.
 *
 * `./config` types `defineConfig` as accepting the config object, a promise of it,
 * or a factory receiving `ConfigEnv`, so the loader accepts all three. The factory
 * is invoked here because this is the only place that knows the invocation the
 * config is being read for; the promise is awaited here because a promise is a
 * non-null object and would otherwise reach the document decoder as one.
 */
const settleConfigDefault = <A = unknown>(
  configFile: string,
  defaultExport: A,
  configEnv: ConfigEnv,
): Effect.Effect<object, ConfigFileInvalidError> =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(defaultExport).then((exported) =>
        isConfigFactory(exported) ? applyConfigFactory(exported, configEnv) : exported
      ),
    catch: (cause) => ConfigFileInvalidError.make({ file: configFile, cause: factoryFailureCause(cause) }),
  }).pipe(Effect.flatMap((settled) => requireDefaultExport(configFile, settled)))

const ERASABLE_SYNTAX_HELP =
  'Config modules may use only erasable TypeScript syntax: no enums, no namespaces with runtime code, no parameter properties, and no decorators.'

const carriesCode = <A = unknown>(cause: unknown): cause is { readonly code: A } =>
  cause instanceof Error && 'code' in cause

function codeOf(coded: { readonly code: string }): string | undefined {
  return typeof coded.code === 'string' ? coded.code : undefined
}

const errorCodeOf = <A = unknown>(cause: A): string | undefined =>
  carriesCode<string>(cause) ? codeOf(cause) : undefined

const errorMessageOf = <A = unknown>(cause: A): string | undefined =>
  cause instanceof Error ? errorTextOf(cause) : undefined

function errorTextOf(error: Error): string | undefined {
  return typeof error.message === 'string' ? error.message : undefined
}

const importFailureDetail = (failure: StrykerError): string => errorMessageOf(failure.cause) ?? failure.message

const configImportCause = (configFile: string, failure: StrykerError): Error | StrykerError =>
  Match.value(errorCodeOf(failure.cause)).pipe(
    Match.when(
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      () =>
        new Error(
          `The config file "${configFile}" uses TypeScript syntax Node cannot execute. ${ERASABLE_SYNTAX_HELP}`,
          {
            cause: failure.cause,
          },
        ),
    ),
    Match.when('ERR_UNKNOWN_FILE_EXTENSION', () =>
      new Error(
        `The config file "${configFile}" has an extension Node cannot load. Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE}.`,
        { cause: failure.cause },
      )),
    Match.when('ERR_MODULE_NOT_FOUND', () =>
      new Error(
        `The config file "${configFile}" imports a module Node cannot find. The specifier is most likely not installed — install it as a dependency of the project, or remove the import. Node reported: ${
          importFailureDetail(failure)
        }`,
        { cause: failure.cause },
      )),
    Match.when('ERR_PACKAGE_PATH_NOT_EXPORTED', () =>
      new Error(
        `The config file "${configFile}" imports a path a package does not export. The package is installed but its "exports" map leaves this specifier out — import a path the package publishes. Node reported: ${
          importFailureDetail(failure)
        }`,
        { cause: failure.cause },
      )),
    Match.orElse(() => failure),
  )

const configModuleUrl = (
  configFile: string,
  pathService: Path.Path,
): Effect.Effect<URL, ConfigFileUnreadableError> =>
  Match.value(configFile.startsWith('file:')).pipe(
    Match.when(true, () =>
      Effect.try({
        try: (): URL => new URL(configFile),
        catch: (cause) => ConfigFileUnreadableError.make({ file: configFile, cause }),
      })),
    Match.orElse(() =>
      pathService.toFileUrl(pathService.resolve(configFile)).pipe(
        Effect.mapError((cause) => ConfigFileUnreadableError.make({ file: configFile, cause })),
      )
    ),
  )

const readConfigModule = (
  configFile: string,
  configEnv: ConfigEnv,
): Effect.Effect<
  PartialStrykerOptions,
  ConfigFileUnreadableError | ConfigFileInvalidError,
  Path.Path
> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const url = yield* configModuleUrl(configFile, pathService)
    const importedModule = yield* importModule(url.href).pipe(
      Effect.mapError(
        (failure) =>
          ConfigFileUnreadableError.make({ file: configFile, cause: configImportCause(configFile, failure) }),
      ),
    )
    const exported = yield* S.decodeUnknownEffect(ImportedModuleSchema)(importedModule).pipe(
      Effect.mapError((cause) => ConfigFileInvalidError.make({ file: configFile, cause })),
      Effect.map((decoded) => decoded.default),
    )
    const document = yield* settleConfigDefault(configFile, exported, configEnv)
    return yield* decodeConfigDocument(configFile, document)
  })

const configFileExtension = (configFile: string, pathService: Path.Path): string =>
  pathService.extname(configFile).toLowerCase().slice(1)

const isLegacyConfigFile = (configFile: string, pathService: Path.Path): boolean =>
  LEGACY_CONFIG_FILE_EXTENSIONS.includes(configFileExtension(configFile, pathService))

const readExtendsChild = (
  configFile: string,
  configEnv: ConfigEnv,
): Effect.Effect<
  PartialStrykerOptions,
  ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  Path.Path
> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    return yield* Match.value(isLegacyConfigFile(configFile, pathService)).pipe(
      Match.when(true, () =>
        Effect.fail(ConfigFileUnsupportedError.make({ file: configFile, hint: extendsChildHint(configFile) }))),
      Match.orElse(() =>
        readConfigModule(configFile, configEnv)
      ),
    )
  })

const canonicalConfigFile = (
  file: string,
  pathService: Path.Path,
): Effect.Effect<string, ConfigFileUnreadableError> =>
  Match.value(file.startsWith('file:')).pipe(
    Match.when(true, () =>
      Effect.try({
        try: (): URL => new URL(file),
        catch: (cause) => ConfigFileUnreadableError.make({ file, cause }),
      }).pipe(
        Effect.flatMap((url) =>
          pathService.fromFileUrl(url).pipe(
            Effect.mapError((cause) => ConfigFileUnreadableError.make({ file, cause })),
          )
        ),
      )),
    Match.orElse(() => Effect.succeed(pathService.resolve(file))),
  )

function resolveExtendsSpecifier(
  specifier: string,
): Effect.Effect<string, ConfigFileUnreadableError> {
  return Effect.try({
    try: (): string => import.meta.resolve(specifier),
    catch: (cause) => ConfigFileUnreadableError.make({ file: specifier, cause }),
  })
}

function resolveExtends(
  configFile: string,
  document: PartialStrykerOptions,
  configEnv: ConfigEnv,
): Effect.Effect<
  PartialStrykerOptions,
  ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  Path.Path
> {
  return Effect.gen(function*() {
    const pathService = yield* Path.Path
    const loop = (
      state: ExtendsStepState,
      file: string,
      currentDocument: PartialStrykerOptions,
    ): Effect.Effect<
      PartialStrykerOptions,
      ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
      Path.Path
    > =>
      Effect.gen(function*() {
        const canonicalFile = yield* canonicalConfigFile(file, pathService)
        return yield* Match.value(decideExtendsStep(state, currentDocument, canonicalFile, pathService)).pipe(
          Match.tag('done', (d) => Effect.succeed(d.options)),
          Match.tag('read', (d) =>
            readExtendsChild(d.path, configEnv).pipe(Effect.flatMap((nextDocument) =>
              loop(d.state, d.path, nextDocument)
            ))),
          Match.tag('resolve', (d) =>
            resolveExtendsSpecifier(d.specifier).pipe(
              Effect.flatMap((resolvedUrl) =>
                readExtendsChild(resolvedUrl, configEnv).pipe(Effect.flatMap((nextDocument) =>
                  loop(d.state, resolvedUrl, nextDocument)
                ))
              ),
            )),
          Match.tag('refused', (d) => {
            let message = `Invalid config file "${d.file}". "extends" must be a string`
            if (d.reason === 'cycle') {
              message = `Config inheritance cycle detected at "${d.file}"`
            }
            return Effect.fail(ConfigFileInvalidError.make({ file: d.file, cause: message }))
          }),
          Match.exhaustive,
        )
      })
    return yield* loop(initialExtendsStepState, configFile, document)
  })
}

export type ValidationSchemaDocument<A = unknown> = {
  readonly properties?: A
  readonly [key: string]: A
}

export const forkCoreSchema = S.toJsonSchemaDocument(forkOptionsSchema).schema

const decodeOptions = S.decodeUnknownResult(StrykerOptionsSchema, { errors: 'all' })

function recordOf<A = unknown>(value: object): Record<string, A> {
  return { ...value }
}

const thresholdErrors = (options: StrykerOptions): readonly string[] =>
  Match.value(options.thresholds.high < options.thresholds.low).pipe(
    Match.when(true, (): readonly string[] => [
      'Config option "thresholds.high" should be higher than "thresholds.low".',
    ]),
    Match.orElse((): readonly string[] => []),
  )

const ignoreStaticErrors = (options: StrykerOptions): readonly string[] =>
  Match.value(options.ignoreStatic && options.coverageAnalysis !== 'perTest').pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "${
        optionsPath('ignoreStatic')
      }" is not supported with coverage analysis "${options.coverageAnalysis}". Either turn off "${
        optionsPath('ignoreStatic')
      }", or configure "${optionsPath('coverageAnalysis')}" to be "perTest".`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

const matchLineNumber = (match: RegExpExecArray, group: number): number => Number.parseInt(match[group] ?? '', 10)

const startLineErrors = (
  index: number,
  mutationRange: string | undefined,
  start: number,
): readonly string[] =>
  Match.value(start < 1).pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Mutation range "${mutationRange}" is invalid, line ${start} does not exist (lines start at 1).`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

const lineOrderErrors = (
  index: number,
  mutationRange: string | undefined,
  start: number,
  end: number,
): readonly string[] =>
  Match.value(start > end).pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Mutation range "${mutationRange}" is invalid. The "from" line number (${start}) should be less then the "to" line number (${end}).`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

const mutationRangeBoundErrors = (index: number, match: RegExpExecArray): readonly string[] => {
  const mutationRange = match[2]
  const start = matchLineNumber(match, 3)
  const end = matchLineNumber(match, 5)
  return [
    ...startLineErrors(index, mutationRange, start),
    ...lineOrderErrors(index, mutationRange, start, end),
  ]
}

const requireUnmagicalMutationRange = (
  mutateString: string,
  index: number,
  match: RegExpExecArray,
): readonly string[] =>
  Match.value(isGlob(mutateString)).pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Cannot combine a glob expression with a mutation range in "${mutateString}".`,
    ]),
    Match.orElse(() => mutationRangeBoundErrors(index, match)),
  )

const mutationRangeErrors = (mutateString: string, index: number): readonly string[] =>
  Match.value(MUTATION_RANGE_REGEX.exec(mutateString)).pipe(
    Match.when(
      (match: RegExpExecArray | null): match is RegExpExecArray => match !== null,
      (match) => requireUnmagicalMutationRange(mutateString, index, match),
    ),
    Match.orElse((): readonly string[] => []),
  )

const warnOnIgnoredNodeArgs = (nodeArgs: readonly string[]): Effect.Effect<void> =>
  Match.value(nodeArgs.length > 0).pipe(
    Match.when(true, () =>
      Effect.logWarning(
        'Using "testRunnerNodeArgs" together with the "command" test runner is not supported, these arguments will be ignored. You can add your custom arguments by setting the "commandRunner.command" option.',
      )),
    Match.orElse(() => Effect.void),
  )

const warnOnCommandRunnerNodeArgs = (options: StrykerOptions): Effect.Effect<void> =>
  Match.value(isCommandRunner(options.testRunner)).pipe(
    Match.when(true, () => warnOnIgnoredNodeArgs(options.testRunnerNodeArgs)),
    Match.orElse(() => Effect.void),
  )

const customValidationErrors = (options: StrykerOptions): readonly string[] => [
  ...thresholdErrors(options),
  ...ignoreStaticErrors(options),
  ...options.mutate.flatMap(mutationRangeErrors),
]

function customValidation(
  options: StrykerOptions,
): Effect.Effect<void, ConfigError> {
  const additionalErrors = customValidationErrors(options)
  return warnOnCommandRunnerNodeArgs(options).pipe(
    Effect.flatMap(() => logConfigErrors(additionalErrors)),
    Effect.flatMap(() => throwErrorIfNeeded(additionalErrors)),
  )
}

function schemaValidate<A = unknown>(
  options: Record<string, A>,
): Effect.Effect<StrykerOptions, ConfigError> {
  const decoded = decodeOptions(options)
  if (Result.isFailure(decoded)) {
    return failWithConfigErrors(describeErrors(decoded.failure))
  }
  Object.assign(options, decoded.success)
  return Effect.succeed(decoded.success)
}

const configErrorHeadline = (errors: readonly string[]): string =>
  Match.value(errors.length === 1).pipe(
    Match.when(true, () => 'Please correct this configuration error and try again.'),
    Match.orElse(() => 'Please correct these configuration errors and try again.'),
  )

const configErrorMessage = (errors: readonly string[]): string => `${configErrorHeadline(errors)} ${errors.join(' ')}`

const logConfigErrors = (errors: readonly string[]): Effect.Effect<void> =>
  Effect.gen(function*() {
    for (const error of errors) {
      yield* Effect.logError(error)
    }
  })

const failWithConfigErrors = (errors: readonly string[]): Effect.Effect<never, ConfigError> =>
  logConfigErrors(errors).pipe(
    Effect.flatMap(() => Effect.fail(ConfigError.make({ message: configErrorMessage(errors) }))),
  )

function throwErrorIfNeeded(errors: readonly string[]): Effect.Effect<void, ConfigError> {
  if (errors.length === 0) return Effect.void
  return Effect.fail(ConfigError.make({ message: configErrorMessage(errors) }))
}

const OPTIONS_ADDED_BY_STRYKER: readonly string[] = ['set', 'configFile', '$schema']

const schemaPropertyNames = (schema: ValidationSchemaDocument): readonly string[] =>
  Match.value(schema['properties']).pipe(
    Match.when(isNonNullObject, (properties) => Object.keys(recordOf(properties))),
    Match.orElse((): readonly string[] => []),
  )

const excessOptionNames = (
  options: StrykerOptions,
  schema: ValidationSchemaDocument,
): readonly string[] => {
  const schemaKeys = schemaPropertyNames(schema)
  return Object.keys(options)
    .filter((key) => key.endsWith('_comment') === false)
    .filter((key) => OPTIONS_ADDED_BY_STRYKER.includes(key) === false)
    .filter((key) => schemaKeys.includes(key) === false)
}

const warnAboutUnknownOptions = (
  options: StrykerOptions,
  excessNames: readonly string[],
): Effect.Effect<void> =>
  Effect.gen(function*() {
    for (const excessPropertyName of excessNames) {
      yield* Effect.logWarning(`Unknown stryker config option "${excessPropertyName}".`)
    }
    const pluginsJson = yield* S.encodeEffect(S.fromJsonString(S.Array(S.String)))([...options.plugins]).pipe(
      Effect.orDie,
    )
    yield* Effect.logWarning(`Possible causes:
     * Is it a typo on your end?
     * Did you only write this property as a comment? If so, please postfix it with "_comment".
     * You might be missing a plugin that is supposed to use it. Stryker loaded plugins from: ${pluginsJson}
     * The plugin that is using it did not contribute explicit validation. 
      (disable "${optionsPath('warnings', 'unknownOptions')}" to ignore this warning)`)
  })

const unknownOptionWarning = (
  options: StrykerOptions,
  schema: ValidationSchemaDocument,
): Effect.Effect<void> => {
  const excessNames = excessOptionNames(options, schema)
  return Match.value(excessNames.length > 0).pipe(
    Match.when(true, () => warnAboutUnknownOptions(options, excessNames)),
    Match.orElse(() => Effect.void),
  )
}

function markExcessOptions(
  options: StrykerOptions,
  schema: ValidationSchemaDocument,
): Effect.Effect<void> {
  return Effect.gen(function*() {
    if (isWarningEnabled('unknownOptions', options.warnings)) {
      yield* unknownOptionWarning(options, schema)
    }
  })
}

const logUnserializableWarnings = (
  unserializables: readonly UnserializableDescription[],
): Effect.Effect<void> =>
  Effect.gen(function*() {
    for (const unserializable of unserializables) {
      yield* Effect.logWarning(
        `Config option "${
          unserializable.path.join('.')
        }" is not (fully) serializable. ${unserializable.reason}. Any test runner or checker worker processes might not receive this value as intended.`,
      )
    }
    yield* Effect.logWarning(`(disable ${optionsPath('warnings', 'unserializableOptions')} to ignore this warning)`)
  })

const warnAboutUnserializableOptions = (options: StrykerOptions): Effect.Effect<void> =>
  Match.value(findUnserializables(options)).pipe(
    Match.when(undefined, () => Effect.void),
    Match.orElse((unserializables) => logUnserializableWarnings(unserializables)),
  )

function markUnserializableOptions(options: StrykerOptions): Effect.Effect<void> {
  return Effect.gen(function*() {
    if (isWarningEnabled('unserializableOptions', options.warnings)) {
      yield* warnAboutUnserializableOptions(options)
    }
  })
}

function markOptions(
  options: StrykerOptions,
  schema: ValidationSchemaDocument,
): Effect.Effect<void> {
  return Effect.gen(function*() {
    yield* markExcessOptions(options, schema)
    yield* markUnserializableOptions(options)
  })
}

export function validateOptions<A = unknown>(
  options: Record<string, A>,
  schema: ValidationSchemaDocument,
): Effect.Effect<StrykerOptions, ConfigError> {
  return Effect.gen(function*() {
    const typed = yield* schemaValidate(options)
    yield* customValidation(typed)
    yield* markOptions(typed, schema)
    return typed
  })
}

export const createDefaultOptions: Effect.Effect<StrykerOptions> = S.decodeEffect(StrykerOptionsSchema)({}).pipe(
  Effect.orDie,
)

export const defaultOptions: Effect.Effect<Immutable<StrykerOptions>, never, never> = Effect.map(
  createDefaultOptions,
  (opts) => deepFreeze(opts),
)

export const CONFIG_SYNTAX_HELP = `
Example of how a config file should look:
/**
  * @type {import('@systemfsoftware/stryker-js-plugin-interface').StrykerOptions}
  */
export default {
  // Your options here!
}

A config file is a TypeScript or ESM JavaScript module: stryker.conf.ts, stryker.config.ts, or the same names with a .mts, .js, or .mjs extension.

See https://stryker-mutator.io/docs/stryker-js/config-file for more information.`.trim()

function exists(fileName: string): Effect.Effect<boolean, ConfigFileUnreadableError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.access(fileName).pipe(
      Effect.as(true),
      Effect.catchTag('PlatformError', (error) =>
        Match.value(error.reason).pipe(
          Match.tag('NotFound', () => Effect.succeed(false)),
          Match.orElse(() => Effect.fail(ConfigFileUnreadableError.make({ file: fileName, cause: error }))),
        )),
      Effect.mapError((error) => ConfigFileUnreadableError.make({ file: fileName, cause: error })),
    )
  })
}

const requireExistingConfigFile = (
  configFileName: string,
): Effect.Effect<
  string,
  ConfigFileNotFoundError | ConfigFileUnreadableError,
  FileSystem.FileSystem
> =>
  exists(configFileName).pipe(
    Effect.flatMap((doesExist) =>
      Match.value(doesExist).pipe(
        Match.when(true, () => Effect.succeed(configFileName)),
        Match.orElse(() => Effect.fail(ConfigFileNotFoundError.make({ file: configFileName }))),
      )
    ),
  )
const firstExistingConfigFile = (
  fileNames: string[],
): Effect.Effect<Option.Option<string>, ConfigFileUnreadableError, FileSystem.FileSystem> =>
  Option.match(Option.fromUndefinedOr(fileNames[0]), {
    onNone: () => Effect.succeedNone,
    onSome: (head) =>
      exists(head).pipe(
        Effect.flatMap((doesExist) => {
          if (doesExist) {
            return Effect.succeedSome(head)
          }
          return firstExistingConfigFile(fileNames.slice(1))
        }),
      ),
  })

const configFileFor = (
  configFileName: string,
): Effect.Effect<
  string,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const supported = SUPPORTED_CONFIG_FILE_EXTENSIONS.includes(configFileExtension(configFileName, pathService))
    const legacy = isLegacyConfigFile(configFileName, pathService)
    return yield* Match.value(supported).pipe(
      Match.when(true, () => requireExistingConfigFile(configFileName)),
      Match.orElse(() =>
        Effect.fail(
          ConfigFileUnsupportedError.make({
            file: configFileName,
            hint: Match.value(legacy).pipe(
              Match.when(true, () => legacyConfigHint(configFileName)),
              Match.orElse(() => unsupportedConfigHint(configFileName)),
            ),
          }),
        )
      ),
    )
  })
const firstLegacyConfigFile = (): Effect.Effect<
  Option.Option<string>,
  ConfigFileUnreadableError,
  FileSystem.FileSystem
> => firstExistingConfigFile([...LEGACY_CONFIG_FILE_NAMES])

const legacyConfigError = (file: string): ConfigFileUnsupportedError =>
  ConfigFileUnsupportedError.make({ file, hint: legacyConfigHint(file) })

const legacyConfigWarning = (file: string, supportedFile: string): Effect.Effect<void> =>
  Effect.logWarning(shadowedLegacyWarning(file, supportedFile))

const refuseLegacyOnlyProject = (): Effect.Effect<
  Option.Option<string>,
  ConfigFileUnreadableError | ConfigFileUnsupportedError,
  FileSystem.FileSystem
> =>
  firstLegacyConfigFile().pipe(
    Effect.flatMap((legacyFile) =>
      Option.match(legacyFile, {
        onNone: () => Effect.succeedNone,
        onSome: (file) => Effect.fail(legacyConfigError(file)),
      })
    ),
  )
const warnShadowedLegacyConfig = (
  supportedFile: string,
): Effect.Effect<string, ConfigFileUnreadableError, FileSystem.FileSystem> =>
  firstLegacyConfigFile().pipe(
    Effect.flatMap((legacyFile) =>
      Option.match(legacyFile, {
        onNone: () => Effect.succeed(supportedFile),
        onSome: (file) => Effect.as(legacyConfigWarning(file, supportedFile), supportedFile),
      })
    ),
  )

const discoverConfigFile = (): Effect.Effect<
  string | undefined,
  ConfigFileUnreadableError | ConfigFileUnsupportedError,
  FileSystem.FileSystem
> =>
  firstExistingConfigFile([...SUPPORTED_CONFIG_FILE_NAMES]).pipe(
    Effect.flatMap((found) =>
      Option.match(found, {
        onNone: () => refuseLegacyOnlyProject().pipe(Effect.map((legacy) => Option.getOrUndefined(legacy))),
        onSome: (supportedFile) => warnShadowedLegacyConfig(supportedFile),
      })
    ),
  )

function findConfigFile<A = unknown>(
  configFileName: A,
): Effect.Effect<
  string | undefined,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return typeof configFileName === 'string' ? configFileFor(configFileName) : discoverConfigFile()
}

const resolveChildExtends = (
  configFile: string,
  child: PartialStrykerOptions,
  configEnv: ConfigEnv,
): Effect.Effect<
  PartialStrykerOptions,
  ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  Path.Path
> => 'extends' in child ? resolveExtends(configFile, child, configEnv) : Effect.succeed(child)

export interface ConfigInvocation {
  readonly command: 'run' | 'merge-reports'
  readonly mode: OutputMode
}

const isCiEnvironment: Effect.Effect<boolean> = Config.String('CI').pipe(
  Effect.map((value) =>
    Match.value(value.trim().toLowerCase()).pipe(
      Match.when('', () => false),
      Match.when('0', () => false),
      Match.when('false', () => false),
      Match.orElse(() => true),
    )
  ),
  Effect.orElseSucceed(() => false),
)

function loadOptionsFromConfigFile(
  cliOptions: PartialStrykerOptions,
  configEnv: ConfigEnv,
): Effect.Effect<
  PartialStrykerOptions,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return findConfigFile(cliOptions['configFile']).pipe(
    Effect.flatMap((configFile) =>
      Match.value(configFile).pipe(
        Match.when(undefined, () => Effect.succeed({})),
        Match.orElse((found) =>
          readConfigModule(found, configEnv).pipe(
            Effect.flatMap((child) => resolveChildExtends(found, child, configEnv)),
          )
        ),
      )
    ),
  )
}
export function readConfig(
  cliOptions: PartialStrykerOptions,
  invocation: ConfigInvocation,
): Effect.Effect<
  StrykerOptions,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function*() {
    const configEnv: ConfigEnv = {
      command: invocation.command,
      mode: invocation.mode,
      isDryRun: cliOptions['dryRunOnly'] === true,
      isCi: yield* isCiEnvironment,
    }
    const cliRecord = yield* S.decodeEffect(ConfigDocumentSchema)(cliOptions).pipe(Effect.orDie)
    const fileRecord = yield* loadOptionsFromConfigFile(cliRecord, configEnv)
    const fileOptions = yield* Result.match(S.decodeResult(ConfigDocumentSchema)(fileRecord), {
      onFailure: (cause) => Effect.fail(ConfigFileInvalidError.make({ file: 'config', cause })),
      onSuccess: (options) => Effect.succeed(options),
    })
    const merged = mergeConfig(fileOptions, cliRecord)
    const decoded = S.decodeUnknownResult(StrykerOptionsSchema)(merged)
    if (Result.isFailure(decoded)) {
      throw ConfigError.make({ message: configErrorMessage(describeErrors(decoded.failure)) })
    }
    return decoded.success
  })
}

export const loadConfigCell = readConfig
