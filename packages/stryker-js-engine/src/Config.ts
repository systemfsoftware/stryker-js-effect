import type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Minimatch, minimatch } from 'minimatch'

import {
  ConfigDocumentSchema,
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
  forkOptionsSchema,
  ImportedModuleSchema,
} from './Config.schema.js'
import { IGNORE_PATTERN_CHARACTER, MUTATION_RANGE_REGEX } from './Project.ignore.js'
import { StrykerError } from './stryker-error.schema.js'
import { isCommandRunner } from './TestRunner.js'
import { getAvailableParallelism } from './Worker.js'

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isMergeableRecord = (value: unknown): value is Record<string, unknown> =>
  isNonNullObject(value) && Array.isArray(value) === false

const assignOverride = (
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> => {
  out[key] = value
  return out
}

const mergeOverrideValue = (
  baseValue: Record<string, unknown>,
  overrideValue: unknown,
): unknown =>
  Match.value(overrideValue).pipe(
    Match.when(isMergeableRecord, (record) => mergeRecords(baseValue, record)),
    Match.orElse(() => overrideValue),
  )

const applyOverrideValue = (
  out: Record<string, unknown>,
  key: string,
  overrideValue: unknown,
): Record<string, unknown> =>
  Match.value(out[key]).pipe(
    Match.when(
      isMergeableRecord,
      (baseValue) => assignOverride(out, key, mergeOverrideValue(baseValue, overrideValue)),
    ),
    Match.orElse(() => assignOverride(out, key, overrideValue)),
  )

const shouldSkipOverride = (key: string, value: unknown): boolean => key === '__proto__' || value === undefined

const applyOverrideEntry = (
  out: Record<string, unknown>,
  entry: [string, unknown],
): Record<string, unknown> =>
  Match.value(shouldSkipOverride(entry[0], entry[1])).pipe(
    Match.when(true, () => out),
    Match.orElse(() => applyOverrideValue(out, entry[0], entry[1])),
  )

export function mergeRecords(
  base: object,
  overrides: object,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  return Object.entries(overrides).reduce(applyOverrideEntry, out)
}

export const REMOVED_OPTIONS: Record<string, string> = {
  'dots': 'the "dots" reporter was removed; use "clear-text" instead',
  'event-recorder':
    'the "event-recorder" reporter was removed; use the "json" reporter or the machine-mode progress stream for structured output',
  'progress-append-only': 'the "progress-append-only" reporter was removed; use "progress-stream" instead',
  'dashboard':
    'the "dashboard" reporter and its options were removed; write the "json" or "html" report and publish it yourself',
  'eventReporter': 'the event-recorder reporter was removed; remove this option',
}

const normalizeFileName = (fileName: string): string => fileName.replace(/\\/g, '/')
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

type ImmutablePrimitive = Primitive | ((...args: never[]) => unknown)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

const isArrayValue = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const freezeArrayValue = (value: readonly unknown[]): unknown => Object.freeze(value.map(deepFreeze))

const freezeMapEntry = (
  [entryKey, entryValue]: readonly [unknown, unknown],
): [unknown, unknown] => [deepFreeze(entryKey), deepFreeze(entryValue)]

const freezeMapValue = (value: Map<unknown, unknown>): unknown =>
  Object.freeze(new Map([...value.entries()].map(freezeMapEntry)))

const freezeSetValue = (value: Set<unknown>): unknown => Object.freeze(new Set([...value.values()].map(deepFreeze)))

const freezeRegExpValue = (value: RegExp): unknown => Object.freeze(value)

const freezeRecordValue = (value: object): unknown =>
  Object.freeze(
    Object.entries(value).reduce<Record<string, unknown>>((frozen, [property, propertyValue]) => {
      frozen[property] = deepFreeze(propertyValue)
      return frozen
    }, {}),
  )

export function deepFreeze<T>(target: T): Immutable<T>
export function deepFreeze(target: unknown): unknown {
  return Match.value(target).pipe(
    Match.when(isArrayValue, freezeArrayValue),
    Match.when((value: unknown): value is Map<unknown, unknown> => value instanceof Map, freezeMapValue),
    Match.when((value: unknown): value is RegExp => value instanceof RegExp, freezeRegExpValue),
    Match.when((value: unknown): value is Set<unknown> => value instanceof Set, freezeSetValue),
    Match.when(isNonNullObject, freezeRecordValue),
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

const describeUnserializableChild = (
  child: unknown,
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

const describeUnserializableArray = (
  value: readonly unknown[],
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

const isPlainObjectValue = (value: object): boolean => {
  const prototype: unknown = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const classNameOf = (value: object): string => {
  const name: string = value.constructor.name
  if (name.length > 0) return name
  return '<anonymous class>'
}

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
): value is bigint | symbol | ((...args: never[]) => unknown) => NON_JSON_PRIMITIVE_TYPES.includes(typeof value)

const describeNonJsonPrimitive = (
  value: bigint | symbol | ((...args: never[]) => unknown),
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

export function findUnserializables(
  thing: unknown,
): UnserializableDescription[] | undefined {
  return Match.value(thing).pipe(
    Match.when((value: unknown): value is number => typeof value === 'number', describeNumber),
    Match.when(isNonJsonPrimitive, describeNonJsonPrimitive),
    Match.when(isNonNullObject, describeUnserializableObject),
    Match.orElse(() => undefined),
  )
}

type KnownKeys<T> = keyof {
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

const DEFAULT_GLOB = '**/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}'

const normalizePattern = (
  pattern: boolean | string,
  pathService: Path.Path,
): boolean | string =>
  Match.value(pattern).pipe(
    Match.when(Match.string, (value) => normalizeFileName(pathService.resolve(value))),
    Match.when(true, () => DEFAULT_GLOB),
    Match.orElse(() => false),
  )

export function createFileMatcher(
  pattern: boolean | string,
  pathService: Path.Path,
  allowHiddenFiles = true,
): (fileName: string) => boolean {
  return Match.value(normalizePattern(pattern, pathService)).pipe(
    Match.when(
      Match.string,
      (normalized) => (fileName: string) =>
        minimatch(normalizeFileName(pathService.resolve(fileName)), normalized, {
          dot: allowHiddenFiles,
        }),
    ),
    Match.orElse((normalized) => () => normalized),
  )
}

export function matchesFile(
  pattern: boolean | string,
  fileName: string,
  pathService: Path.Path,
  allowHiddenFiles = true,
): boolean {
  return createFileMatcher(pattern, pathService, allowHiddenFiles)(fileName)
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

export function importModule(
  moduleName: string,
): Effect.Effect<unknown, StrykerError> {
  return Effect.tryPromise({
    try: (): Promise<unknown> => import(moduleName),
    catch: (cause) => StrykerError.make({ message: `Failed to import module "${moduleName}"`, cause }),
  })
}

export interface ExtendsStepState {
  readonly visited: readonly string[]
  readonly documents: readonly ExtendsStepDocument[]
}

export interface ExtendsStepDocument {
  readonly path: string
  readonly options: PartialStrykerOptions
}

export const initialExtendsStepState: ExtendsStepState = {
  visited: [],
  documents: [],
}

export type ExtendsRefusalReason = 'cycle' | 'non-string-extends'

const DoneTag = { _tag: 'done' } as const
type DoneTag = typeof DoneTag
const ReadTag = { _tag: 'read' } as const
type ReadTag = typeof ReadTag
const ResolveTag = { _tag: 'resolve' } as const
type ResolveTag = typeof ResolveTag
const RefusedTag = { _tag: 'refused' } as const
type RefusedTag = typeof RefusedTag

export type ExtendsStepDecision =
  | DoneTag & { readonly options: PartialStrykerOptions }
  | ReadTag & { readonly path: string; readonly state: ExtendsStepState }
  | ResolveTag & { readonly specifier: string; readonly state: ExtendsStepState }
  | RefusedTag & { readonly reason: ExtendsRefusalReason; readonly file: string }

const asUnknownArray = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) return value
  return []
}

const isFirstDescriptorOccurrence =
  (descriptors: readonly unknown[]) => (descriptor: unknown, index: number): boolean =>
    typeof descriptor !== 'string' || descriptors.slice(0, index).includes(descriptor) === false

const mergePluginDescriptors = (
  parentPlugins: readonly unknown[],
  childPlugins: readonly unknown[],
): readonly unknown[] => {
  const merged = [...parentPlugins, ...childPlugins]
  return merged.filter(isFirstDescriptorOccurrence(merged))
}

const setConfigEntry = (
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> => {
  out[key] = value
  return out
}

const removeConfigEntry = (out: Record<string, unknown>, key: string): Record<string, unknown> => {
  delete out[key]
  return out
}

const applyMergedEntry = (
  out: Record<string, unknown>,
  key: string,
  parentValue: Record<string, unknown>,
  childValue: unknown,
): Record<string, unknown> =>
  Match.value(childValue).pipe(
    Match.when(isMergeableRecord, (mergeableChild) => setConfigEntry(out, key, { ...parentValue, ...mergeableChild })),
    Match.orElse(() => setConfigEntry(out, key, childValue)),
  )

const applyValueEntry = (
  out: Record<string, unknown>,
  key: string,
  parentValue: unknown,
  childValue: unknown,
): Record<string, unknown> =>
  Match.value(parentValue).pipe(
    Match.when(isMergeableRecord, (mergeableParent) => applyMergedEntry(out, key, mergeableParent, childValue)),
    Match.orElse(() => setConfigEntry(out, key, childValue)),
  )

const applyPluginsEntry = (
  out: Record<string, unknown>,
  key: string,
  parentValue: unknown,
  childValue: unknown,
): Record<string, unknown> =>
  setConfigEntry(
    out,
    key,
    mergePluginDescriptors(asUnknownArray(parentValue), asUnknownArray(childValue)),
  )

const applyConfigEntry = (
  out: Record<string, unknown>,
  key: string,
  parentValue: unknown,
  childValue: unknown,
): Record<string, unknown> =>
  Match.value(childValue).pipe(
    Match.when(null, () => removeConfigEntry(out, key)),
    Match.orElse(() =>
      Match.value(key).pipe(
        Match.when('plugins', () => applyPluginsEntry(out, key, parentValue, childValue)),
        Match.orElse(() => applyValueEntry(out, key, parentValue, childValue)),
      )
    ),
  )

const applyChildConfigEntry = (
  parent: PartialStrykerOptions,
  out: Record<string, unknown>,
  entry: [string, unknown],
): Record<string, unknown> => applyConfigEntry(out, entry[0], Reflect.get(parent, entry[0]), entry[1])

export function mergeConfigs(
  parent: PartialStrykerOptions,
  child: PartialStrykerOptions,
): PartialStrykerOptions {
  return Object.entries(child).reduce(
    (out, entry) => applyChildConfigEntry(parent, out, entry),
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
    return { ...RefusedTag, reason: 'cycle', file }
  }
  const nextState: ExtendsStepState = {
    visited: [...state.visited, file],
    documents: [...state.documents, { path: file, options: document }],
  }
  return Match.value(Reflect.get(document, 'extends')).pipe(
    Match.when(undefined, (): ExtendsStepDecision => ({
      ...DoneTag,
      options: mergeChainDocuments(nextState.documents),
    })),
    Match.when(null, (): ExtendsStepDecision => ({
      ...DoneTag,
      options: mergeChainDocuments(nextState.documents),
    })),
    Match.when(Match.string, (extendValue) =>
      Match.value(isModuleSpecifier(extendValue)).pipe(
        Match.when(true, (): ExtendsStepDecision => ({
          ...ResolveTag,
          specifier: extendValue,
          state: nextState,
        })),
        Match.when(false, (): ExtendsStepDecision => ({
          ...ReadTag,
          path: pathService.resolve(pathService.dirname(file), extendValue),
          state: nextState,
        })),
        Match.exhaustive,
      )),
    Match.orElse((): ExtendsStepDecision => ({ ...RefusedTag, reason: 'non-string-extends', file })),
  )
}

const decodeConfigDocument = (
  configFile: string,
  document: unknown,
): Effect.Effect<PartialStrykerOptions, ConfigFileInvalidError> =>
  S.decodeUnknownEffect(ConfigDocumentSchema)(document).pipe(
    Effect.mapError((cause) => ConfigFileInvalidError.make({ file: configFile, cause })),
  )

const requireDefaultExport = (
  configFile: string,
  defaultExport: unknown,
): Effect.Effect<object, ConfigFileInvalidError> =>
  Match.value(defaultExport).pipe(
    Match.when(undefined, () =>
      Effect.fail(
        ConfigFileInvalidError.make({ file: configFile, cause: 'Config file must have a default export!' }),
      )),
    Match.when(isNonNullObject, (value) => Effect.succeed(value)),
    Match.orElse(() =>
      Effect.fail(
        ConfigFileInvalidError.make({ file: configFile, cause: 'Default export of config file must be an object!' }),
      )
    ),
  )

const ERASABLE_SYNTAX_HELP =
  'Config modules may use only erasable TypeScript syntax: no enums, no namespaces with runtime code, no parameter properties, and no decorators.'

const errorCodeOf = (cause: unknown): string | undefined => {
  const code: unknown = Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error): unknown => Reflect.get(error, 'code')),
    Match.orElse(() => undefined),
  )
  if (typeof code === 'string') return code
  return undefined
}

const errorMessageOf = (cause: unknown): string | undefined => {
  const message: unknown = Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error): unknown => Reflect.get(error, 'message')),
    Match.orElse(() => undefined),
  )
  if (typeof message === 'string') return message
  return undefined
}

const importFailureDetail = (failure: StrykerError): string => errorMessageOf(failure.cause) ?? failure.message

const configImportCause = (configFile: string, failure: StrykerError): unknown =>
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
    const document = yield* requireDefaultExport(configFile, exported)
    return yield* decodeConfigDocument(configFile, document)
  })

const configFileExtension = (configFile: string, pathService: Path.Path): string =>
  pathService.extname(configFile).toLowerCase().slice(1)

const isLegacyConfigFile = (configFile: string, pathService: Path.Path): boolean =>
  LEGACY_CONFIG_FILE_EXTENSIONS.includes(configFileExtension(configFile, pathService))

const readExtendsChild = (
  configFile: string,
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
        readConfigModule(configFile)
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

export function resolveExtends(
  configFile: string,
  document: PartialStrykerOptions,
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
            readExtendsChild(d.path).pipe(Effect.flatMap((nextDocument) => loop(d.state, d.path, nextDocument)))),
          Match.tag('resolve', (d) =>
            resolveExtendsSpecifier(d.specifier).pipe(
              Effect.flatMap((resolvedUrl) =>
                readExtendsChild(resolvedUrl).pipe(Effect.flatMap((nextDocument) =>
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

export type ValidationSchemaDocument = {
  readonly properties?: unknown
  readonly [key: string]: unknown
}

export const forkCoreSchema: Record<string, unknown> = S.toJsonSchemaDocument(forkOptionsSchema).schema

const decodeOptions = S.decodeUnknownResult(StrykerOptionsSchema, { errors: 'all' })

function recordOf(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    out[key] = Reflect.get(value, key)
  }
  return out
}

const isRemovedOption = (key: string): boolean => Object.hasOwn(REMOVED_OPTIONS, key)

const removedOptionError = (key: string): string =>
  `Config option "${key}" is no longer supported. ${REMOVED_OPTIONS[key]}`

const isRemovedReporterName = (name: unknown): name is string =>
  typeof name === 'string' && Object.hasOwn(REMOVED_OPTIONS, name)

const removedReporterNameError = (name: string): string =>
  `Config option "reporters" contains removed reporter name "${name}". ${REMOVED_OPTIONS[name]}`

const removedReporterErrors = (reporters: unknown): readonly string[] =>
  Match.value(reporters).pipe(
    Match.when(isArrayValue, (names) => names.filter(isRemovedReporterName).map(removedReporterNameError)),
    Match.orElse((): readonly string[] => []),
  )

const removedOptionErrors = (rawOptions: Record<string, unknown>): readonly string[] => [
  ...Object.keys(rawOptions).filter(isRemovedOption).map(removedOptionError),
  ...removedReporterErrors(rawOptions['reporters']),
]

function validateRemovedSurface(
  rawOptions: Record<string, unknown>,
): Effect.Effect<void, ConfigError> {
  const errors = removedOptionErrors(rawOptions)
  return logConfigErrors(errors).pipe(Effect.flatMap(() => throwErrorIfNeeded(errors)))
}

function removeStringMutator(rawOptions: Record<string, unknown>): Effect.Effect<void> {
  const mutator = rawOptions['mutator']
  if (typeof mutator !== 'string') return Effect.void
  return Effect.gen(function*() {
    yield* Effect.logWarning(
      'DEPRECATED. Use of "mutator" as string is no longer needed. You can remove it from your configuration. Stryker now supports mutating of JavaScript and friend files out of the box.',
    )
    delete rawOptions['mutator']
  })
}

const recordHoldingMember = (
  record: Record<string, unknown>,
  member: string,
): Record<string, unknown> | undefined =>
  Match.value(record[member]).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse(() => record),
  )

const mutatorRecordWithName = (
  rawOptions: Record<string, unknown>,
): Record<string, unknown> | undefined =>
  Match.value(rawOptions['mutator']).pipe(
    Match.when(isNonNullObject, (mutator) => recordHoldingMember(recordOf(mutator), 'name')),
    Match.orElse(() => undefined),
  )

function removeMutatorName(rawOptions: Record<string, unknown>): Effect.Effect<void> {
  const mutatorRecord = mutatorRecordWithName(rawOptions)
  if (mutatorRecord === undefined) return Effect.void
  return Effect.gen(function*() {
    yield* Effect.logWarning(
      'DEPRECATED. Use of "mutator.name" is no longer needed. You can remove "mutator.name" from your configuration. Stryker now supports mutating of JavaScript and friend files out of the box.',
    )
    delete mutatorRecord['name']
    rawOptions['mutator'] = mutatorRecord
  })
}

function removeTestFramework(rawOptions: Record<string, unknown>): Effect.Effect<void> {
  if (!Object.keys(rawOptions).includes('testFramework')) return Effect.void
  return Effect.gen(function*() {
    yield* Effect.logWarning(
      'DEPRECATED. Use of "testFramework" is no longer needed. You can remove it from your configuration. Your test runner plugin now handles its own test framework integration.',
    )
    delete rawOptions['testFramework']
  })
}

const DEFAULT_TRANSPILER_EXAMPLE = 'npm run build'

const TRANSPILER_EXAMPLE_BY_NAME: Record<string, string> = {
  'babel': 'babel src --out-dir lib',
  'typescript': 'tsc -b',
  'webpack': 'webpack --config webpack.config.js',
}

const transpilerExample = (transpilers: readonly unknown[]): string =>
  Match.value(Object.entries(TRANSPILER_EXAMPLE_BY_NAME).find(([name]) => transpilers.includes(name))).pipe(
    Match.when(undefined, () => DEFAULT_TRANSPILER_EXAMPLE),
    Match.orElse(([, entryExample]) => entryExample),
  )

function removeTranspilers(rawOptions: Record<string, unknown>): Effect.Effect<void> {
  const transpilers = rawOptions['transpilers']
  if (Array.isArray(transpilers) === false) return Effect.void
  const example = transpilerExample(transpilers)
  return Effect.gen(function*() {
    yield* Effect.logWarning(
      `DEPRECATED. Support for "transpilers" is removed. You can now configure your own "${
        optionsPath('buildCommand')
      }". For example, ${example}.`,
    )
    delete rawOptions['transpilers']
  })
}

function rewriteFiles(rawOptions: Record<string, unknown>): Effect.Effect<void> {
  const files = rawOptions['files']
  if (!Array.isArray(files)) return Effect.void
  const ignorePatternsName = optionsPath('ignorePatterns')
  const filePatterns = files.filter((uncertain): uncertain is string => typeof uncertain === 'string')
  const newIgnorePatterns: string[] = [
    '**',
    ...filePatterns.map((filePattern) => {
      if (filePattern.startsWith(IGNORE_PATTERN_CHARACTER)) {
        return filePattern.slice(1)
      }
      return `${IGNORE_PATTERN_CHARACTER}${filePattern}`
    }),
  ]
  delete rawOptions['files']
  return Effect.gen(function*() {
    const patternsJson = yield* S.encodeEffect(S.fromJsonString(S.Array(S.String)))([...newIgnorePatterns]).pipe(
      Effect.orDie,
    )
    yield* Effect.logWarning(
      `DEPRECATED. Use of "files" is deprecated, please use "${ignorePatternsName}" instead (or remove "files" altogether will probably work as well). For now, rewriting them as ${patternsJson}. See https://stryker-mutator.io/docs/stryker-js/configuration/#ignorepatterns-string`,
    )
    let existingIgnorePatterns: unknown[] = []
    const candidate = rawOptions[ignorePatternsName]
    if (Array.isArray(candidate)) {
      existingIgnorePatterns = candidate
    }
    rawOptions[ignorePatternsName] = [...newIgnorePatterns, ...existingIgnorePatterns]
  })
}

const jestRecordWithEnableBail = (
  rawOptions: Record<string, unknown>,
): Record<string, unknown> | undefined =>
  Match.value(rawOptions['jest']).pipe(
    Match.when(isNonNullObject, (jestOptions) => recordHoldingMember(recordOf(jestOptions), 'enableBail')),
    Match.orElse(() => undefined),
  )

const isFalsy = (value: unknown): boolean => Boolean(value) === false

function removeJestEnableBail(rawOptions: Record<string, unknown>): Effect.Effect<void> {
  const jestRecord = jestRecordWithEnableBail(rawOptions)
  if (jestRecord === undefined) return Effect.void
  return Effect.gen(function*() {
    yield* Effect.logWarning(
      'DEPRECATED. Use of "jest.enableBail" is deprecated, please use "disableBail" instead. See https://stryker-mutator.io/docs/stryker-js/configuration#disablebail-boolean',
    )
    const enableBail = jestRecord['enableBail']
    rawOptions['disableBail'] = isFalsy(enableBail)
    delete jestRecord['enableBail']
    rawOptions['jest'] = jestRecord
  })
}

const ABSENT_BASE_DIR_VALUES: readonly unknown[] = [undefined, null, '']

const isAbsentBaseDir = (value: unknown): boolean => ABSENT_BASE_DIR_VALUES.includes(value)

const baseDirTextOf = (baseDir: unknown): string =>
  Match.value(baseDir).pipe(
    Match.when(Match.string, (text) => text),
    Match.orElse(() => JSON.stringify(baseDir)),
  )

const reporterWithBaseDir = (
  rawOptions: Record<string, unknown>,
): Record<string, unknown> | undefined =>
  Match.value(rawOptions['htmlReporter']).pipe(
    Match.when(isNonNullObject, (htmlReporter) => {
      const reporter = recordOf(htmlReporter)
      if (isAbsentBaseDir(reporter['baseDir'])) return undefined
      return reporter
    }),
    Match.orElse(() => undefined),
  )

function removeHtmlReporterBaseDir(
  rawOptions: Record<string, unknown>,
  pathService: Path.Path,
): Effect.Effect<void> {
  const reporter = reporterWithBaseDir(rawOptions)
  if (reporter === undefined) return Effect.void
  return Effect.gen(function*() {
    const baseDirText = baseDirTextOf(reporter['baseDir'])
    yield* Effect.logWarning(
      `DEPRECATED. Use of "htmlReporter.baseDir" is deprecated, please use "${
        optionsPath('htmlReporter', 'fileName')
      }" instead. See https://stryker-mutator.io/docs/stryker-js/configuration/#reporters-string`,
    )
    const fileName = reporter['fileName']
    if (fileName === undefined) {
      reporter['fileName'] = pathService.join(baseDirText, 'index.html')
    }
    delete reporter['baseDir']
    rawOptions['htmlReporter'] = reporter
  })
}

const isMigratableMaxConcurrent = (value: unknown): value is number =>
  typeof value === 'number' && value !== Number.MAX_SAFE_INTEGER

const shouldApplyMigratedConcurrency = (
  concurrency: unknown,
  maxConcurrent: number,
  availableParallelism: number,
): boolean => (concurrency === undefined) && maxConcurrent < availableParallelism - 1

function migrateMaxConcurrentTestRunners(
  rawOptions: Record<string, unknown>,
): Effect.Effect<void> {
  const maxConcurrent = rawOptions['maxConcurrentTestRunners']
  if (isMigratableMaxConcurrent(maxConcurrent) === false) return Effect.void
  return Effect.gen(function*() {
    yield* Effect.logWarning(
      'DEPRECATED. Use of "maxConcurrentTestRunners" is deprecated. Please use "concurrency" instead.',
    )
    const availableParallelism = yield* Effect.sync(getAvailableParallelism)
    if (shouldApplyMigratedConcurrency(rawOptions['concurrency'], maxConcurrent, availableParallelism)) {
      rawOptions['concurrency'] = maxConcurrent
    }
  })
}

function removeDeprecatedOptions(
  rawOptions: Record<string, unknown>,
  pathService: Path.Path,
): Effect.Effect<void> {
  return Effect.gen(function*() {
    yield* removeStringMutator(rawOptions)
    yield* removeMutatorName(rawOptions)
    yield* removeTestFramework(rawOptions)
    yield* removeTranspilers(rawOptions)
    yield* rewriteFiles(rawOptions)
    yield* removeJestEnableBail(rawOptions)
    yield* removeHtmlReporterBaseDir(rawOptions, pathService)
    yield* migrateMaxConcurrentTestRunners(rawOptions)
  })
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
  Match.value(new Minimatch(mutateString).hasMagic()).pipe(
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

function schemaValidate(
  options: Record<string, unknown>,
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

export function validateOptions(
  options: Record<string, unknown>,
  schema: ValidationSchemaDocument,
): Effect.Effect<StrykerOptions, ConfigError, Path.Path> {
  return Effect.gen(function*() {
    const pathService = yield* Path.Path
    yield* removeDeprecatedOptions(options, pathService)
    yield* validateRemovedSurface(options)
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
  * @type {import('@systemfsoftware/stryker-js-language').StrykerOptions}
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

function findConfigFile(
  configFileName: unknown,
): Effect.Effect<
  string | undefined,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return Match.value(configFileName).pipe(
    Match.when(Match.string, (fileName) => configFileFor(fileName)),
    Match.orElse(() => discoverConfigFile()),
  )
}

const resolveChildExtends = (
  configFile: string,
  child: Record<string, unknown>,
): Effect.Effect<
  unknown,
  ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  Path.Path
> =>
  Match.value('extends' in child).pipe(
    Match.when(true, () => resolveExtends(configFile, child)),
    Match.orElse(() => Effect.succeed(child)),
  )

function loadOptionsFromConfigFile(
  cliOptions: Record<string, unknown>,
): Effect.Effect<
  unknown,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return findConfigFile(cliOptions['configFile']).pipe(
    Effect.flatMap((configFile) =>
      Match.value(configFile).pipe(
        Match.when(undefined, () => Effect.succeed({})),
        Match.orElse((found) =>
          readConfigModule(found).pipe(Effect.flatMap((child) => resolveChildExtends(found, child)))
        ),
      )
    ),
  )
}
export function readConfig(
  cliOptions: PartialStrykerOptions,
): Effect.Effect<
  StrykerOptions,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function*() {
    const cliRecord = yield* S.decodeUnknownEffect(ConfigDocumentSchema)(cliOptions).pipe(Effect.orDie)
    const fileRecord = yield* loadOptionsFromConfigFile(cliRecord)
    const fileOptions = yield* Result.match(S.decodeUnknownResult(ConfigDocumentSchema)(fileRecord), {
      onFailure: (cause) => Effect.fail(ConfigFileInvalidError.make({ file: 'config', cause })),
      onSuccess: (options) => Effect.succeed(options),
    })
    const merged = mergeRecords(fileOptions, cliRecord)
    const decoded = S.decodeUnknownResult(StrykerOptionsSchema)(merged)
    if (Result.isFailure(decoded)) {
      throw ConfigError.make({ message: configErrorMessage(describeErrors(decoded.failure)) })
    }
    return decoded.success
  })
}
