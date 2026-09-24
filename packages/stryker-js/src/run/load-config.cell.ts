import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { isCommandRunner } from '../command-runner.resource.js'
import {
  ConfigDocumentSchema,
  type ExtendsStepDecision,
  type ExtendsStepDocument,
  ExtendsStepDone,
  ExtendsStepRead,
  ExtendsStepRefused,
  ExtendsStepResolve,
  type ExtendsStepState,
  forkOptionsSchema,
  ImportedModuleSchema,
} from '../Config.schema.js'
import { type ConfigEnv, StrykerConfig } from '../config/stryker-config.schema.js'
import {
  ResolveWarningEnabledCommand,
  WarningDisabled,
  WarningEnabled,
  warningEnabled,
} from '../config/warning-enabled.workflow.js'
import {
  ConfigError,
  ConfigFactoryFailed,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
  ConfigModuleUnloadable,
} from '../ConfigError.schema.js'
import { MutationRangeSpecifier, MutationRangeSpecifierSchema } from '../MutationRange.schema.js'
import type { OutputMode } from '../output-mode.schema.js'
import { StrykerError } from '../stryker-error.schema.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'

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

const DISCOVERABLE_CONFIG_FILE_NAMES = Object.freeze(configFileNames(SUPPORTED_CONFIG_FILE_EXTENSIONS))

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

const describeMessageOf = (message: string): readonly string[] => {
  const state = message
    .split('\n')
    .reduce(advanceErrorDescription, EMPTY_ERROR_DESCRIPTION_STATE)
  return errorMessageOrFallback(completedErrorMessages(state), message)
}

export function describeErrors(error: S.SchemaError): readonly string[] {
  return describeMessageOf(error.message)
}

export function importModule<A = unknown>(
  moduleName: string,
): Effect.Effect<A, StrykerError> {
  return Effect.tryPromise({
    try: (): Promise<A> => import(moduleName),
    catch: (cause) => StrykerError.make({ message: `Failed to import module "${moduleName}"`, cause }),
  })
}

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

type ConfigOptionValue = Options.PartialStrykerOptions extends Record<string, infer OptionValue> ? OptionValue : never

const inheritEntry = (
  out: Options.PartialStrykerOptions,
  key: string,
  parentValue: ConfigOptionValue,
  childValue: ConfigOptionValue,
): Options.PartialStrykerOptions =>
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

export const mergeConfigs = dual<
  (child: Options.PartialStrykerOptions) => (parent: Options.PartialStrykerOptions) => Options.PartialStrykerOptions,
  (parent: Options.PartialStrykerOptions, child: Options.PartialStrykerOptions) => Options.PartialStrykerOptions
>(2, (parent, child) =>
  Object.entries(child).reduce(
    (out, entry) => inheritEntry(out, entry[0], parent[entry[0]], entry[1]),
    { ...parent },
  ))

const RELATIVE_SPECIFIER_PREFIXES: readonly string[] = ['./', '../', '/', '\\']

export function isModuleSpecifier(value: string): boolean {
  return RELATIVE_SPECIFIER_PREFIXES.every((prefix) => value.startsWith(prefix) === false)
}

const stripExtends = (document: Options.PartialStrykerOptions): Options.PartialStrykerOptions => {
  const { extends: _ignored, ...rest } = document
  return rest
}

const mergeChainDocuments = (documents: readonly ExtendsStepDocument[]): Options.PartialStrykerOptions =>
  documents.reduceRight<Options.PartialStrykerOptions>(
    (merged, entry) => mergeConfigs(merged, stripExtends(entry.options)),
    {},
  )

export const decideExtendsStep = dual<
  (
    document: Options.PartialStrykerOptions,
    file: string,
    pathService: Path.Path,
  ) => (state: ExtendsStepState) => ExtendsStepDecision,
  (
    state: ExtendsStepState,
    document: Options.PartialStrykerOptions,
    file: string,
    pathService: Path.Path,
  ) => ExtendsStepDecision
>(
  4,
  (state, document, file, pathService) => {
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
  },
)

const decodeConfigDocument = <A = unknown>(
  configFile: string,
  document: A,
): Effect.Effect<Options.PartialStrykerOptions, ConfigFileInvalidError> =>
  S.decodeUnknownEffect(ConfigDocumentSchema)(document).pipe(
    Effect.mapError((cause) => ConfigFileInvalidError.make({ file: configFile, cause })),
  )

const failInvalidConfig = (configFile: string, cause: string): Effect.Effect<object, ConfigFileInvalidError> =>
  Effect.fail(ConfigFileInvalidError.make({ file: configFile, cause }))

const requireDefaultExport = <A = unknown>(
  configFile: string,
  defaultExport: A,
): Effect.Effect<object, ConfigFileInvalidError> =>
  Match.value(defaultExport === undefined).pipe(
    Match.when(true, () => failInvalidConfig(configFile, 'Config file must have a default export!')),
    Match.orElse(() => settleObjectExport(configFile, defaultExport)),
  )

function settleObjectExport<A = unknown>(
  configFile: string,
  value: A,
): Effect.Effect<object, ConfigFileInvalidError> {
  return Option.match(Option.liftPredicate(isNonNullObject)(value), {
    onSome: (present) => Effect.succeed(present),
    onNone: () => failInvalidConfig(configFile, 'Default export of config file must be an object!'),
  })
}

type ConfigFactory<A = unknown> = (env: ConfigEnv) => A

const isConfigFactory = (value: unknown): value is ConfigFactory => typeof value === 'function'

const FACTORY_FAILED = "Evaluating the config module's exported factory failed"

const factoryFailureOf = <A>(cause: A): ConfigFactoryFailed =>
  ConfigFactoryFailed.make({
    cause,
    message: Option.match(ErrorText.CauseText.fromCause(cause), {
      onNone: () => FACTORY_FAILED,
      onSome: (detail) => `${FACTORY_FAILED}: ${detail.text}`,
    }),
  })

const applyConfigFactory = <A = unknown>(factory: ConfigFactory<A>, configEnv: ConfigEnv): A => factory(configEnv)

/**
 * Settle a config module's default export into the object the document schema decodes.
 *
 * `./config` types `StrykerConfig.define` as accepting the config object, a promise of it,
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
    catch: (cause) => ConfigFileInvalidError.make({ file: configFile, cause: factoryFailureOf(cause) }),
  }).pipe(Effect.flatMap((settled) => requireDefaultExport(configFile, settled)))

const ERASABLE_SYNTAX_HELP =
  'Config modules may use only erasable TypeScript syntax: no enums, no namespaces with runtime code, no parameter properties, and no decorators.'

const thrownErrorOf = (cause: StrykerError['cause']): Option.Option<Error> =>
  Option.map(S.decodeUnknownOption(S.instanceOf(Error))(cause), (error) => error)

const stringCodeOf = (error: Error) =>
  Option.map(
    Option.liftPredicate(error, (value): value is Error & { readonly code: string } =>
      'code' in value && typeof value.code === 'string'),
    (coded) =>
      coded.code,
  )

const errorCodeOf = (cause: StrykerError['cause']): string | undefined =>
  Option.getOrUndefined(Option.flatMap(thrownErrorOf(cause), stringCodeOf))

const errorMessageOf = (cause: StrykerError['cause']): string | undefined =>
  Option.getOrUndefined(Option.map(thrownErrorOf(cause), (error) => error.message))

const importFailureDetail = (failure: StrykerError): string => errorMessageOf(failure.cause) ?? failure.message

const unloadableConfigModule = (
  configFile: string,
  code: string,
  failure: StrykerError,
  message: string,
): ConfigModuleUnloadable => ConfigModuleUnloadable.make({ code, file: configFile, message, cause: failure.cause })

const configImportCause = (configFile: string, failure: StrykerError) =>
  Match.value(errorCodeOf(failure.cause)).pipe(
    Match.when('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', () =>
      unloadableConfigModule(
        configFile,
        'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
        failure,
        `The config file "${configFile}" uses TypeScript syntax Node cannot execute. ${ERASABLE_SYNTAX_HELP}`,
      )),
    Match.when('ERR_UNKNOWN_FILE_EXTENSION', () =>
      unloadableConfigModule(
        configFile,
        'ERR_UNKNOWN_FILE_EXTENSION',
        failure,
        `The config file "${configFile}" has an extension Node cannot load. Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE}.`,
      )),
    Match.when('ERR_MODULE_NOT_FOUND', () =>
      unloadableConfigModule(
        configFile,
        'ERR_MODULE_NOT_FOUND',
        failure,
        `The config file "${configFile}" imports a module Node cannot find. The specifier is most likely not installed — install it as a dependency of the project, or remove the import. Node reported: ${
          importFailureDetail(failure)
        }`,
      )),
    Match.when('ERR_PACKAGE_PATH_NOT_EXPORTED', () =>
      unloadableConfigModule(
        configFile,
        'ERR_PACKAGE_PATH_NOT_EXPORTED',
        failure,
        `The config file "${configFile}" imports a path a package does not export. The package is installed but its "exports" map leaves this specifier out — import a path the package publishes. Node reported: ${
          importFailureDetail(failure)
        }`,
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
  Options.PartialStrykerOptions,
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
  Options.PartialStrykerOptions,
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
  document: Options.PartialStrykerOptions,
  configEnv: ConfigEnv,
): Effect.Effect<
  Options.PartialStrykerOptions,
  ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  Path.Path
> {
  return Effect.gen(function*() {
    const pathService = yield* Path.Path
    const loop = (
      state: ExtendsStepState,
      file: string,
      currentDocument: Options.PartialStrykerOptions,
    ): Effect.Effect<
      Options.PartialStrykerOptions,
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
          Match.tag('refused', (d) =>
            Effect.fail(
              ConfigFileInvalidError.make({
                file: d.file,
                cause: Match.value(d.reason).pipe(
                  Match.when('cycle', () =>
                    `Config inheritance cycle detected at "${d.file}"`),
                  Match.orElse(() =>
                    `Invalid config file "${d.file}". "extends" must be a string`
                  ),
                ),
              }),
            )),
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

const decodeOptions = S.decodeUnknownResult(Options.StrykerOptionsSchema, { errors: 'all' })

function recordOf<A = unknown>(value: object): Record<string, A> {
  return { ...value }
}

const thresholdErrors = (options: Options.StrykerOptions): readonly string[] =>
  Match.value(options.thresholds.high < options.thresholds.low).pipe(
    Match.when(true, (): readonly string[] => [
      'Config option "thresholds.high" should be higher than "thresholds.low".',
    ]),
    Match.orElse((): readonly string[] => []),
  )

const ignoreStaticErrors = (options: Options.StrykerOptions): readonly string[] =>
  Match.value(options.ignoreStatic && options.coverageAnalysis !== 'perTest').pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "${'ignoreStatic'}" is not supported with coverage analysis "${options.coverageAnalysis}". Either turn off "${'ignoreStatic'}", or configure "${'coverageAnalysis'}" to be "perTest".`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

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

const columnSuffixOf = (column: number | undefined): string =>
  Option.match(Option.fromUndefinedOr(column), {
    onNone: () => '',
    onSome: (present) => `:${present}`,
  })

const rangeTextOf = (specifier: MutationRangeSpecifier): string =>
  `${specifier.startLine}${columnSuffixOf(specifier.startColumn)}-${specifier.endLine}${
    columnSuffixOf(specifier.endColumn)
  }`

const mutationRangeBoundErrors = (index: number, specifier: MutationRangeSpecifier): readonly string[] => [
  ...startLineErrors(index, rangeTextOf(specifier), specifier.startLine),
  ...lineOrderErrors(index, rangeTextOf(specifier), specifier.startLine, specifier.endLine),
]

const GLOB_META = /[*?[{]/

const isGlob = (value: string) => GLOB_META.test(value)

const requireUnmagicalMutationRange = (
  mutateString: string,
  index: number,
  specifier: MutationRangeSpecifier,
): readonly string[] =>
  Boolean.match(isGlob(mutateString), {
    onTrue: (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Cannot combine a glob expression with a mutation range in "${mutateString}".`,
    ],
    onFalse: () => mutationRangeBoundErrors(index, specifier),
  })

const mutationRangeErrors = (mutateString: string, index: number): readonly string[] =>
  Option.match(S.decodeOption(MutationRangeSpecifierSchema)(mutateString), {
    onNone: (): readonly string[] => [],
    onSome: (specifier) => requireUnmagicalMutationRange(mutateString, index, specifier),
  })

const warnOnIgnoredNodeArgs = (nodeArgs: readonly string[]): Effect.Effect<void> =>
  Match.value(nodeArgs.length > 0).pipe(
    Match.when(true, () =>
      Effect.logWarning(
        'Using "testRunnerNodeArgs" together with the "command" test runner is not supported, these arguments will be ignored. You can add your custom arguments by setting the "commandRunner.command" option.',
      )),
    Match.orElse(() => Effect.void),
  )

const warnOnCommandRunnerNodeArgs = (options: Options.StrykerOptions): Effect.Effect<void> =>
  Match.value(isCommandRunner(options.testRunner)).pipe(
    Match.when(true, () => warnOnIgnoredNodeArgs(options.testRunnerNodeArgs)),
    Match.orElse(() => Effect.void),
  )

const customValidationErrors = (options: Options.StrykerOptions): readonly string[] => [
  ...thresholdErrors(options),
  ...ignoreStaticErrors(options),
  ...options.mutate.flatMap(mutationRangeErrors),
]

function customValidation(
  options: Options.StrykerOptions,
): Effect.Effect<void, ConfigError> {
  const additionalErrors = customValidationErrors(options)
  return warnOnCommandRunnerNodeArgs(options).pipe(
    Effect.flatMap(() => logConfigErrors(additionalErrors)),
    Effect.flatMap(() => throwErrorIfNeeded(additionalErrors)),
  )
}

const schemaValidate = <A = unknown>(options: Record<string, A>): Effect.Effect<Options.StrykerOptions, ConfigError> =>
  Result.match(decodeOptions(options), {
    onFailure: (failure) => failure.pipe(describeErrors, failWithConfigErrors),
    onSuccess: (success) => Effect.as(Effect.sync(() => Object.assign(options, success)), success),
  })

const configErrorHeadline = (errors: readonly string[]): string =>
  Match.value(errors.length === 1).pipe(
    Match.when(true, () => 'Please correct this configuration error and try again.'),
    Match.orElse(() => 'Please correct these configuration errors and try again.'),
  )

const configErrorMessage = (errors: readonly string[]): string => `${configErrorHeadline(errors)} ${errors.join(' ')}`

const logConfigErrors = (errors: readonly string[]): Effect.Effect<void> =>
  Effect.forEach(errors, (error) => Effect.logError(error), { discard: true })

const failWithConfigErrors = (errors: readonly string[]): Effect.Effect<never, ConfigError> =>
  logConfigErrors(errors).pipe(
    Effect.flatMap(() => Effect.fail(ConfigError.make({ message: configErrorMessage(errors) }))),
  )

const throwErrorIfNeeded = (errors: readonly string[]): Effect.Effect<void, ConfigError> =>
  Boolean.match(errors.length === 0, {
    onTrue: () => Effect.void,
    onFalse: () => Effect.fail(ConfigError.make({ message: configErrorMessage(errors) })),
  })

const OPTIONS_ADDED_BY_STRYKER: readonly string[] = ['set', 'configFile', '$schema']

const schemaPropertyNames = (schema: ValidationSchemaDocument): readonly string[] =>
  Match.value(schema['properties']).pipe(
    Match.when(isNonNullObject, (properties) => Object.keys(recordOf(properties))),
    Match.orElse((): readonly string[] => []),
  )

const excessOptionNames = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): readonly string[] => {
  const schemaKeys = schemaPropertyNames(schema)
  return Object.keys(options)
    .filter((key) => key.endsWith('_comment') === false)
    .filter((key) => OPTIONS_ADDED_BY_STRYKER.includes(key) === false)
    .filter((key) => schemaKeys.includes(key) === false)
}

const warnAboutUnknownOptions = (
  options: Options.StrykerOptions,
  excessNames: readonly string[],
): Effect.Effect<void> =>
  Effect.gen(function*() {
    for (const excessPropertyName of excessNames) {
      yield* Effect.logWarning(`Unknown stryker config option "${excessPropertyName}".`)
    }
    const pluginsJson = yield* S.encodeEffect(S.String.pipe(S.Array, S.fromJsonString))([...options.plugins]).pipe(
      Effect.orDie,
    )
    yield* Effect.logWarning(`Possible causes:
     * Is it a typo on your end?
     * Did you only write this property as a comment? If so, please postfix it with "_comment".
     * You might be missing a plugin that is supposed to use it. Stryker loaded plugins from: ${pluginsJson}
     * The plugin that is using it did not contribute explicit validation. 
      (disable "${'warnings.unknownOptions'}" to ignore this warning)`)
  })

const unknownOptionWarning = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): Effect.Effect<void> => {
  const excessNames = excessOptionNames(options, schema)
  return Match.value(excessNames.length > 0).pipe(
    Match.when(true, () => warnAboutUnknownOptions(options, excessNames)),
    Match.orElse(() => Effect.void),
  )
}

const warningDecisionOf = (
  warning: 'unknownOptions' | 'unserializableOptions',
  warnings: Options.StrykerOptions['warnings'],
): WarningEnabled | WarningDisabled =>
  Result.match(warningEnabled(ResolveWarningEnabledCommand.make({ warning, warnings })), {
    onSuccess: (decision) => decision,
    onFailure: () => WarningDisabled.make({}),
  })

const markExcessOptions = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): Effect.Effect<void> =>
  Match.value(warningDecisionOf('unknownOptions', options.warnings)).pipe(
    Match.tag('WarningEnabled', () => unknownOptionWarning(options, schema)),
    Match.tag('WarningDisabled', () => Effect.void),
    Match.exhaustive,
  )

const logUnserializableWarnings = (
  unserializables: ReadonlyArray<UnserializableDescription>,
): Effect.Effect<void> =>
  Effect.forEach(
    unserializables,
    (unserializable) =>
      Effect.logWarning(
        `Config option "${
          unserializable.path.join('.')
        }" is not (fully) serializable. ${unserializable.reason}. Any test runner or checker worker processes might not receive this value as intended.`,
      ),
    { discard: true },
  ).pipe(
    Effect.andThen(() => Effect.logWarning(`(disable ${'warnings.unserializableOptions'} to ignore this warning)`)),
  )

type UnserializableDescription = {
  readonly path: ReadonlyArray<string>
  readonly reason: string
}

const NON_JSON_PRIMITIVE_TYPES: Record<string, true> = {
  bigint: true,
  function: true,
  symbol: true,
}

const scopedUnserializable =
  (scope: string) => (description: UnserializableDescription): UnserializableDescription => ({
    ...description,
    path: [scope, ...description.path],
  })

const describedChild = <A>(scope: string) => (child: A): UnserializableDescription[] =>
  Option.match(Option.fromUndefinedOr(findUnserializables(child)), {
    onNone: () => [],
    onSome: (descriptions) => descriptions.map(scopedUnserializable(scope)),
  })

const describedEntries = <A>(
  entries: ReadonlyArray<readonly [string, A]>,
): UnserializableDescription[] => entries.flatMap(([scope, child]) => describedChild(scope)(child))

const classNameOf = (value: object): string =>
  Match.value(value.constructor).pipe(
    Match.when(Match.defined, (constructor) => constructor.name),
    Match.orElse(() => 'Object'),
  )

const describeUnserializableInstance = (value: object): UnserializableDescription[] => [
  {
    path: [],
    reason: `Value is an instance of "${
      classNameOf(
        value,
      )
    }", this detail will get lost in translation during serialization`,
  },
]

const isArrayValue = <A = unknown>(value: unknown): value is ReadonlyArray<A> => Array.isArray(value)

const isPlainObjectValue = (value: object): boolean => Array.isArray(value) === false && value.constructor === Object

const describedIndexedChildren = <A = unknown>(arrayed: ReadonlyArray<A>): UnserializableDescription[] =>
  describedEntries(arrayed.map((child, index) => [index.toString(), child] as const))

const describeUnserializableObject = (value: object): UnserializableDescription[] =>
  Match.value(value).pipe(
    Match.when(isArrayValue, describedIndexedChildren),
    Match.orElse((recorded) =>
      Option.match(
        Option.liftPredicate(recorded, isPlainObjectValue),
        {
          onNone: () => describeUnserializableInstance(recorded),
          onSome: (plain) => describedEntries(Object.entries(plain)),
        },
      )
    ),
  )

const describeUnserializableNonNullish = <A>(value: A): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(value, isNonNullObject), {
    onNone: () => [],
    onSome: (present) => describeUnserializableObject(present),
  })
const isNumberValue = (value: unknown): value is number => typeof value === 'number'

type JsonlessPrimitive = bigint | symbol | ((...args: never[]) => void)

const isNonJsonPrimitive = (value: unknown): value is JsonlessPrimitive =>
  NON_JSON_PRIMITIVE_TYPES[typeof value] === true

const primitiveKindOf = (primitive: JsonlessPrimitive): string => typeof primitive

const describeUnserializablePrimitive = (primitive: JsonlessPrimitive): UnserializableDescription[] => [
  {
    path: [],
    reason: `Primitive type "${primitiveKindOf(primitive)}" has no JSON representation`,
  },
]

const describeUnserializableUnknown = <A>(value: A): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(value, isNonJsonPrimitive), {
    onNone: () => describeUnserializableNonNullish(value),
    onSome: describeUnserializablePrimitive,
  })

const hasDescriptions = (found: UnserializableDescription[]): boolean => found.length > 0

const describeUnserializableFiniteNumber = (value: number): UnserializableDescription[] =>
  Boolean.match(Number.isFinite(value), {
    onTrue: () => [],
    onFalse: () => [
      {
        path: [],
        reason: `Number value \`${value}\` has no JSON representation`,
      },
    ],
  })

const describeUnserializableValue = <A>(value: A): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(value, isNumberValue), {
    onNone: () => describeUnserializableUnknown(value),
    onSome: describeUnserializableFiniteNumber,
  })
const findUnserializables = <A>(thing: A): UnserializableDescription[] | undefined =>
  Option.match(
    Option.filter(Option.some(describeUnserializableValue(thing)), hasDescriptions),
    {
      onNone: () => undefined,
      onSome: (found) => found,
    },
  )
const warnAboutUnserializableOptions = (options: Options.StrykerOptions): Effect.Effect<void> =>
  Option.match(Option.fromUndefinedOr(findUnserializables(options)), {
    onNone: () => Effect.void,
    onSome: (unserializables) => logUnserializableWarnings(unserializables),
  })

const markUnserializableOptions = (options: Options.StrykerOptions): Effect.Effect<void> =>
  Match.value(warningDecisionOf('unserializableOptions', options.warnings)).pipe(
    Match.tag('WarningEnabled', () => warnAboutUnserializableOptions(options)),
    Match.tag('WarningDisabled', () => Effect.void),
    Match.exhaustive,
  )

function markOptions(
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): Effect.Effect<void> {
  return Effect.gen(function*() {
    yield* markExcessOptions(options, schema)
    yield* markUnserializableOptions(options)
  })
}

export const validateOptions = dual<
  <A = unknown>(
    schema: ValidationSchemaDocument,
  ) => (options: Record<string, A>) => Effect.Effect<Options.StrykerOptions, ConfigError>,
  <A = unknown>(
    options: Record<string, A>,
    schema: ValidationSchemaDocument,
  ) => Effect.Effect<Options.StrykerOptions, ConfigError>
>(
  2,
  (options, schema) =>
    Effect.gen(function*() {
      const typed = yield* schemaValidate(options)
      yield* customValidation(typed)
      yield* markOptions(typed, schema)
      return typed
    }),
)

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
        Effect.flatMap((doesExist) =>
          Match.value(doesExist).pipe(
            Match.when(true, () => Effect.succeedSome(head)),
            Match.orElse(() => firstExistingConfigFile(fileNames.slice(1))),
          )
        ),
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
): Effect.Effect<string, ConfigFileUnreadableError | ConfigFileUnsupportedError, FileSystem.FileSystem> =>
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
  firstExistingConfigFile([...DISCOVERABLE_CONFIG_FILE_NAMES]).pipe(
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
  return Option.match(
    Option.liftPredicate((value: unknown): value is string => typeof value === 'string')(configFileName),
    {
      onSome: (found) => configFileFor(found),
      onNone: () => discoverConfigFile(),
    },
  )
}

const resolveChildExtends = (
  configFile: string,
  child: Options.PartialStrykerOptions,
  configEnv: ConfigEnv,
): Effect.Effect<
  Options.PartialStrykerOptions,
  ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  Path.Path
> =>
  Match.value('extends' in child).pipe(
    Match.when(true, () => resolveExtends(configFile, child, configEnv)),
    Match.orElse(() => Effect.succeed(child)),
  )

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
  cliOptions: Options.PartialStrykerOptions,
  configEnv: ConfigEnv,
): Effect.Effect<
  Option.Option<Options.PartialStrykerOptions>,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> {
  return findConfigFile(cliOptions['configFile']).pipe(
    Effect.flatMap((configFile) =>
      Match.value(configFile).pipe(
        Match.when(undefined, () => Effect.succeedNone),
        Match.orElse((found) =>
          readConfigModule(found, configEnv).pipe(
            Effect.flatMap((child) => resolveChildExtends(found, child, configEnv)),
            Effect.asSome,
          )
        ),
      )
    ),
  )
}
const readLoadConfig = (input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly invocation: ConfigInvocation
}) =>
  Effect.gen(function*() {
    const configEnv: ConfigEnv = {
      command: input.invocation.command,
      mode: input.invocation.mode,
      isDryRun: input.cliOptions['dryRunOnly'] === true,
      isCi: yield* isCiEnvironment,
    }
    const cliRecord = yield* S.decodeEffect(ConfigDocumentSchema)(input.cliOptions).pipe(Effect.orDie)
    return yield* loadOptionsFromConfigFile(cliRecord, configEnv).pipe(
      Effect.map((fileOptions) =>
        LoadConfigCommand.make({
          document: StrykerConfig.merge(Option.getOrElse(fileOptions, () => ({})), cliRecord),
          fileFound: Option.isSome(fileOptions),
        })
      ),
    )
  })

export const loadConfig = Sandwich.named('stryker.config_read')(readLoadConfig)
  .decide(resolveConfig)
  .write({
    ConfigFromFile: ({ options }) => Effect.succeed(options),
    ConfigFromDefaults: ({ options }) => Effect.succeed(options),
    ConfigOptionsRefused: ({ message }) =>
      Effect.fail(ConfigError.make({ message: configErrorMessage(describeMessageOf(message)) })),
    CommandRejected: ({ issue }) => Effect.fail(ConfigError.make({ message: issue })),
  })

export const readConfig: {
  (
    invocation: ConfigInvocation,
  ): (
    cliOptions: Options.PartialStrykerOptions,
  ) => Effect.Effect<
    Options.StrykerOptions,
    ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
    FileSystem.FileSystem | Path.Path
  >
  (
    cliOptions: Options.PartialStrykerOptions,
    invocation: ConfigInvocation,
  ): Effect.Effect<
    Options.StrykerOptions,
    ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
    FileSystem.FileSystem | Path.Path
  >
} = dual(
  2,
  (cliOptions: Options.PartialStrykerOptions, invocation: ConfigInvocation) =>
    loadConfig.run({ cliOptions, invocation }),
)

export interface LoadedConfig {
  readonly options: Options.StrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
  readonly basePath: string
}

const emitPreparePhaseEntered = phaseEntered('prepare')

const readRunConfig = (input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
}) =>
  Effect.gen(function*() {
    const env = yield* RunEnvironment
    const raw = yield* readLoadConfig({
      cliOptions: input.cliOptions,
      invocation: { command: 'run', mode: env.resolvedMode.mode },
    }).pipe(Effect.tapCause(() => emitPreparePhaseEntered))
    return Object.assign(
      raw,
      {
        targetMutatePatterns: input.targetMutatePatterns,
        basePath: env.basePath,
      },
    )
  })

export const loadConfigCell = Sandwich.named('stryker.load_config')(readRunConfig)
  .decide(resolveConfig)
  .write({
    ConfigFromFile: ({ options }, raw) =>
      Effect.succeed({
        options,
        targetMutatePatterns: raw.targetMutatePatterns,
        basePath: raw.basePath,
      }),
    ConfigFromDefaults: ({ options }, raw) =>
      Effect.succeed({
        options,
        targetMutatePatterns: raw.targetMutatePatterns,
        basePath: raw.basePath,
      }),
    ConfigOptionsRefused: ({ message }) => failConfigWith(configErrorMessage(describeMessageOf(message))),
    CommandRejected: ({ issue }) => failConfigWith(issue),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Logger = await import('effect/Logger')

  const JsonLeaf = S.Union([S.Finite, S.String, S.Boolean, S.Null])
  const JsonSiblings = S.Record(S.String, S.Union([JsonLeaf, S.Array(JsonLeaf), S.Record(S.String, JsonLeaf)]))

  const serializabilityWarningsOf = <A = unknown>(options: Record<string, A>) =>
    Effect.gen(function*() {
      const warnings: string[] = []
      const recording = Logger.layer([
        Logger.make((entry) => {
          warnings.push([entry.message].flat().map(String).join(' '))
        }),
      ])
      yield* validateOptions(options, forkCoreSchema).pipe(Effect.provide(recording))
      return warnings.filter((warning) => warning.includes('is not (fully) serializable'))
    })

  it.effect.prop(
    '∀siblings,key_ValidateOptions_WarnsOnlyForTheNonJsonLeaf',
    [JsonSiblings, S.String, S.Boolean],
    ([siblings, key, asFunction]) =>
      Effect.map(
        serializabilityWarningsOf({
          custom: { nested: { ...structuredClone(siblings), [key]: asFunction ? () => key : 1n } },
        }),
        (warnings) => {
          const expected = `Config option "custom.nested.${key}" is not`
          return warnings.map((warning) => warning.slice(0, expected.length)).join('|') === expected
        },
      ),
  )
}
