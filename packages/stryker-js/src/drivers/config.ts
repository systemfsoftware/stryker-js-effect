import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  type ConfigDocument,
  ConfigDocumentSchema,
  type ExtendsStepState,
  ImportedModuleSchema,
  LegacyConfigFileExtensions,
  SupportedConfigFileExtensions,
} from '../Config.schema.js'
import { mergeConfig } from '../config/merge-config.js'
import type { ConfigEnv } from '../config/stryker-config.schema.js'
import {
  ConfigFactoryFailed,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
  ConfigModuleUnloadable,
} from '../ConfigError.schema.js'
import {
  DescribeConfigImportCommand,
  describeConfigModuleFailure,
} from '../run/describe-config-module-failure.workflow.js'
import {
  ConfigDiscoveryCommand,
  type ConfigDiscoveryDecision,
  type ConfigFileKindValue,
  ConfigFileRequest,
  discoverConfigFile,
} from '../run/discover-config-file.workflow.js'
import { extendsStep, ExtendsStepCommand } from '../run/extends-step.workflow.js'
import { StrykerError } from '../stryker-error.schema.js'

export function importModule<A = unknown>(moduleName: string): Effect.Effect<A, StrykerError> {
  return Effect.tryPromise({
    try: (): Promise<A> => import(moduleName),
    catch: (cause) => StrykerError.make({ message: `Failed to import module "${moduleName}"`, cause }),
  })
}

export const initialExtendsStepState: ExtendsStepState = {
  visited: [],
  documents: [],
}

export const decideExtendsStep = extendsStep

const CONFIG_FILE_NAME_PREFIXES: readonly string[] = ['', '.']
const CONFIG_FILE_NAME_SUFFIXES: readonly string[] = ['.conf', '.config']
const SUPPORTED_CONFIG_FILE_EXTENSIONS: readonly string[] = SupportedConfigFileExtensions.literals
const LEGACY_CONFIG_FILE_EXTENSIONS: readonly string[] = LegacyConfigFileExtensions.literals

const combine = (
  prefixes: readonly string[],
  suffixes: readonly string[],
  extensions: readonly string[],
): readonly string[] =>
  prefixes.flatMap((prefix) =>
    suffixes.flatMap((suffix) => extensions.map((extension) => `${prefix}stryker${suffix}.${extension}`))
  )

const configFileNames = (extensions: readonly string[]): readonly string[] =>
  combine(CONFIG_FILE_NAME_PREFIXES, CONFIG_FILE_NAME_SUFFIXES, extensions)

const DISCOVERABLE_CONFIG_FILE_NAMES: readonly string[] = Object.freeze(
  configFileNames(SUPPORTED_CONFIG_FILE_EXTENSIONS),
)

const LEGACY_CONFIG_FILE_NAMES: readonly string[] = Object.freeze(configFileNames(LEGACY_CONFIG_FILE_EXTENSIONS))

const configFileExtension = (configFile: string, pathService: Path.Path): string =>
  pathService.extname(configFile).toLowerCase().slice(1)

const isLegacyConfigFile = (configFile: string, pathService: Path.Path): boolean =>
  LEGACY_CONFIG_FILE_EXTENSIONS.includes(configFileExtension(configFile, pathService))

const supportedConfigFileKindValue = (configFile: string, pathService: Path.Path): ConfigFileKindValue =>
  Boolean.match(SUPPORTED_CONFIG_FILE_EXTENSIONS.includes(configFileExtension(configFile, pathService)), {
    onTrue: (): ConfigFileKindValue => 'supported',
    onFalse: (): ConfigFileKindValue => 'unsupported',
  })

const cliConfigFileKindValue = (configFile: string, pathService: Path.Path): ConfigFileKindValue =>
  Boolean.match(isLegacyConfigFile(configFile, pathService), {
    onTrue: (): ConfigFileKindValue => 'legacy',
    onFalse: () => supportedConfigFileKindValue(configFile, pathService),
  })

const extendsChildKind = (configFile: string, pathService: Path.Path): ConfigFileKindValue =>
  Boolean.match(isLegacyConfigFile(configFile, pathService), {
    onTrue: (): ConfigFileKindValue => 'legacy',
    onFalse: (): ConfigFileKindValue => 'supported',
  })

const exists = Effect.fn('stryker.config.exists')(function*(fileName: string) {
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

const firstExistingConfigFile = (
  fileNames: readonly string[],
): Effect.Effect<Option.Option<string>, ConfigFileUnreadableError, FileSystem.FileSystem> =>
  Stream.fromIterable(fileNames).pipe(
    Stream.mapEffect((fileName) => exists(fileName).pipe(Effect.map((present) => ({ fileName, present })))),
    Stream.filter((probed) => probed.present),
    Stream.map((probed) => probed.fileName),
    Stream.runHead,
  )

const discoveryDecisionOf = (command: ConfigDiscoveryCommand): ConfigDiscoveryDecision =>
  Result.getOrElse(discoverConfigFile(command), (neverError) => neverError)

const actionableConfigFileOf = (
  decision: ConfigDiscoveryDecision,
): Effect.Effect<Option.Option<string>, ConfigFileNotFoundError | ConfigFileUnsupportedError> =>
  Match.value(decision).pipe(
    Match.tag('ConfigFileRead', (read) =>
      Option.match(Option.fromUndefinedOr(read.shadowedLegacyWarning), {
        onSome: (warning) => Effect.as(Effect.logWarning(warning), Option.some(read.file)),
        onNone: () => Effect.succeedSome(read.file),
      })),
    Match.tag(
      'ConfigFileRefused',
      (refused) => Effect.fail(ConfigFileUnsupportedError.make({ file: refused.file, hint: refused.hint })),
    ),
    Match.tag('ConfigFileMissing', (missing) => Effect.fail(ConfigFileNotFoundError.make({ file: missing.file }))),
    Match.tag('NoConfigFile', () => Effect.succeedNone),
    Match.exhaustive,
  )

const configFilePresence = (
  configFileName: string,
  kind: ConfigFileKindValue,
): Effect.Effect<boolean, ConfigFileUnreadableError, FileSystem.FileSystem> =>
  kind === 'supported' ? exists(configFileName) : Effect.succeed(false)

const expectedConfigFileOf = Effect.fn('stryker.config.expectedFile')(function*(
  configFileName: string,
  context: 'cli' | 'extends',
) {
  const pathService = yield* Path.Path
  const kind = Boolean.match(context === 'extends', {
    onTrue: () => extendsChildKind(configFileName, pathService),
    onFalse: () => cliConfigFileKindValue(configFileName, pathService),
  })
  const presentEffect: Effect.Effect<boolean, ConfigFileUnreadableError, FileSystem.FileSystem> = context === 'extends'
    ? Effect.succeed(true)
    : configFilePresence(configFileName, kind)
  const present = yield* presentEffect
  const request = ConfigFileRequest.make({ file: configFileName, kind, exists: present })
  const decision = discoveryDecisionOf(ConfigDiscoveryCommand.make({ context, requested: request }))
  const found = yield* actionableConfigFileOf(decision)
  return yield* Effect.fromOption(found, () => ConfigFileNotFoundError.make({ file: configFileName }))
})

const discoverConfigFileEffect = Effect.fn('stryker.config.discover')(function*() {
  const discovered = yield* firstExistingConfigFile(DISCOVERABLE_CONFIG_FILE_NAMES)
  const legacyPresent = yield* firstExistingConfigFile(LEGACY_CONFIG_FILE_NAMES)
  return yield* actionableConfigFileOf(
    discoveryDecisionOf(ConfigDiscoveryCommand.make({
      context: 'cli',
      discovered: Option.getOrUndefined(discovered),
      legacyPresent: Option.getOrUndefined(legacyPresent),
    })),
  )
})

const findConfigFile = <A>(
  configFileName: A,
): Effect.Effect<
  Option.Option<string>,
  ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileUnsupportedError,
  FileSystem.FileSystem | Path.Path
> =>
  Option.match(
    Option.liftPredicate((value: unknown): value is string => typeof value === 'string')(configFileName),
    {
      onSome: (found) => expectedConfigFileOf(found, 'cli').pipe(Effect.asSome),
      onNone: () => discoverConfigFileEffect(),
    },
  )

const canonicalConfigFile = (
  file: string,
  pathService: Path.Path,
): Effect.Effect<string, ConfigFileUnreadableError> =>
  Boolean.match(file.startsWith('file:'), {
    onTrue: () =>
      Effect.try({
        try: (): URL => new URL(file),
        catch: (cause) => ConfigFileUnreadableError.make({ file, cause }),
      }).pipe(
        Effect.flatMap((url) =>
          pathService.fromFileUrl(url).pipe(
            Effect.mapError((cause) => ConfigFileUnreadableError.make({ file, cause })),
          )
        ),
      ),
    onFalse: () => Effect.succeed(pathService.resolve(file)),
  })

const configModuleUrl = (
  configFile: string,
  pathService: Path.Path,
): Effect.Effect<URL, ConfigFileUnreadableError> =>
  Boolean.match(configFile.startsWith('file:'), {
    onTrue: () =>
      Effect.try({
        try: (): URL => new URL(configFile),
        catch: (cause) => ConfigFileUnreadableError.make({ file: configFile, cause }),
      }),
    onFalse: () =>
      pathService.toFileUrl(pathService.resolve(configFile)).pipe(
        Effect.mapError((cause) => ConfigFileUnreadableError.make({ file: configFile, cause })),
      ),
  })

const resolveExtendsSpecifier = (specifier: string): Effect.Effect<string, ConfigFileUnreadableError> =>
  Effect.try({
    try: (): string => import.meta.resolve(specifier),
    catch: (cause) => ConfigFileUnreadableError.make({ file: specifier, cause }),
  })

const configImportCauseOf = (configFile: string, failure: StrykerError): StrykerError | ConfigModuleUnloadable =>
  Match.value(
    Result.getOrElse(
      describeConfigModuleFailure(
        DescribeConfigImportCommand.make({ file: configFile, message: failure.message, cause: failure.cause }),
      ),
      (neverError) => neverError,
    ),
  ).pipe(
    Match.tag('ConfigImportDescribed', (described) =>
      ConfigModuleUnloadable.make({
        code: described.code,
        file: configFile,
        message: described.message,
        cause: failure.cause,
      })),
    Match.tag('ConfigImportUnclassified', () => failure),
    Match.exhaustive,
  )

const FACTORY_FAILED = "Evaluating the config module's exported factory failed"

const factoryFailureOf = <A>(cause: A): ConfigFactoryFailed =>
  ConfigFactoryFailed.make({
    cause,
    message: Option.match(ErrorText.causeTextOf(cause), {
      onNone: () => FACTORY_FAILED,
      onSome: (detail) => `${FACTORY_FAILED}: ${detail.text}`,
    }),
  })

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isConfigFactory = (value: unknown): value is (env: ConfigEnv) => ConfigDocument => typeof value === 'function'

const failInvalidConfig = (configFile: string, cause: string): Effect.Effect<object, ConfigFileInvalidError> =>
  Effect.fail(ConfigFileInvalidError.make({ file: configFile, cause }))

const settleObjectExport = <A>(configFile: string, value: A): Effect.Effect<object, ConfigFileInvalidError> =>
  Option.match(Option.liftPredicate(isNonNullObject)(value), {
    onSome: (present) => Effect.succeed(present),
    onNone: () => failInvalidConfig(configFile, 'Default export of config file must be an object!'),
  })

const requireDefaultExport = <A>(configFile: string, defaultExport: A): Effect.Effect<object, ConfigFileInvalidError> =>
  Boolean.match(defaultExport === undefined, {
    onTrue: () => failInvalidConfig(configFile, 'Config file must have a default export!'),
    onFalse: () => settleObjectExport(configFile, defaultExport),
  })

const settleConfigDefault = <A>(
  configFile: string,
  defaultExport: A,
  configEnv: ConfigEnv,
): Effect.Effect<object, ConfigFileInvalidError> =>
  Effect.tryPromise({
    try: (): Promise<A | ConfigDocument> =>
      Promise.resolve(defaultExport).then((exported) => isConfigFactory(exported) ? exported(configEnv) : exported),
    catch: (cause) => ConfigFileInvalidError.make({ file: configFile, cause: factoryFailureOf(cause) }),
  }).pipe(Effect.flatMap((settled) => requireDefaultExport(configFile, settled)))

const decodeConfigDocument = <A>(
  configFile: string,
  document: A,
): Effect.Effect<ConfigDocument, ConfigFileInvalidError> =>
  S.decodeUnknownEffect(ConfigDocumentSchema)(document).pipe(
    Effect.mapError((cause) => ConfigFileInvalidError.make({ file: configFile, cause })),
  )

const readConfigModule = Effect.fn('stryker.config.readModule')(function*(
  configFile: string,
  configEnv: ConfigEnv,
) {
  const pathService = yield* Path.Path
  const url = yield* configModuleUrl(configFile, pathService)
  const importedModule = yield* importModule<S.Schema.Type<typeof ImportedModuleSchema>>(url.href).pipe(
    Effect.mapError((failure) =>
      ConfigFileUnreadableError.make({ file: configFile, cause: configImportCauseOf(configFile, failure) })
    ),
  )
  const exported = yield* S.decodeEffect(ImportedModuleSchema)(importedModule).pipe(
    Effect.mapError((cause) => ConfigFileInvalidError.make({ file: configFile, cause })),
    Effect.map((decoded) => decoded.default),
  )
  const document = yield* settleConfigDefault(configFile, exported, configEnv)
  return yield* decodeConfigDocument(configFile, document)
})

const readExtendsChild = (
  configFile: string,
  configEnv: ConfigEnv,
): Effect.Effect<
  ConfigDocument,
  ConfigReadError,
  FileSystem.FileSystem | Path.Path
> => expectedConfigFileOf(configFile, 'extends').pipe(Effect.flatMap((file) => readConfigModule(file, configEnv)))

const resolveExtends = Effect.fn('stryker.config.extends')(function*(
  configFile: string,
  document: ConfigDocument,
  configEnv: ConfigEnv,
) {
  const pathService = yield* Path.Path
  const loop: (
    state: ExtendsStepState,
    file: string,
    currentDocument: ConfigDocument,
  ) => Effect.Effect<
    ConfigDocument,
    ConfigReadError,
    FileSystem.FileSystem | Path.Path
  > = Effect.fn('stryker.config.extendsStep')(function*(
    state: ExtendsStepState,
    file: string,
    currentDocument: ConfigDocument,
  ) {
    const canonicalFile = yield* canonicalConfigFile(file, pathService)
    const readChild: (
      specifier: string,
      nextState: ExtendsStepState,
    ) => Effect.Effect<ConfigDocument, ConfigReadError, FileSystem.FileSystem | Path.Path> = Effect.fn(
      'stryker.config.extendsChild',
    )(function*(specifier: string, nextState: ExtendsStepState) {
      const childFile = pathService.resolve(pathService.dirname(canonicalFile), specifier)
      const childDocument = yield* readExtendsChild(childFile, configEnv)
      return yield* loop(nextState, childFile, childDocument)
    })
    const resolvedChild = (
      specifier: string,
      nextState: ExtendsStepState,
    ): Effect.Effect<ConfigDocument, ConfigReadError, FileSystem.FileSystem | Path.Path> =>
      resolveExtendsSpecifier(specifier).pipe(
        Effect.flatMap((resolvedUrl) =>
          readExtendsChild(resolvedUrl, configEnv).pipe(
            Effect.flatMap((childDocument) => loop(nextState, resolvedUrl, childDocument)),
          )
        ),
      )
    return yield* Match.value(
      extendsStep(ExtendsStepCommand.make({ state, document: currentDocument, file: canonicalFile })),
    ).pipe(
      Match.tag('done', (decision) => Effect.succeed(decision.options)),
      Match.tag('read', (decision) => readChild(decision.specifier, decision.state)),
      Match.tag('resolve', (decision) => resolvedChild(decision.specifier, decision.state)),
      Match.tag(
        'refused',
        (decision) =>
          Effect.fail(
            ConfigFileInvalidError.make({
              file: decision.file,
              cause: Match.value(decision.reason).pipe(
                Match.when('cycle', () => `Config inheritance cycle detected at "${decision.file}"`),
                Match.orElse(() => `Invalid config file "${decision.file}". "extends" must be a string`),
              ),
            }),
          ),
      ),
      Match.exhaustive,
    )
  })

  return yield* loop(initialExtendsStepState, configFile, document)
})

const resolveChildExtends = (
  configFile: string,
  child: ConfigDocument,
  configEnv: ConfigEnv,
): Effect.Effect<
  ConfigDocument,
  ConfigReadError,
  FileSystem.FileSystem | Path.Path
> =>
  Boolean.match('extends' in child, {
    onTrue: () => resolveExtends(configFile, child, configEnv),
    onFalse: () => Effect.succeed(child),
  })

const loadOptionsFromConfigFile = Effect.fn('stryker.config.loadOptions')(function*(
  cliOptions: ConfigDocument,
  configEnv: ConfigEnv,
) {
  const configFile = yield* findConfigFile(cliOptions['configFile'])
  return yield* Option.match(configFile, {
    onNone: () => Effect.succeedNone,
    onSome: (found) =>
      readConfigModule(found, configEnv).pipe(
        Effect.flatMap((child) => resolveChildExtends(found, child, configEnv)),
        Effect.asSome,
      ),
  })
})

export type ConfigReadError =
  | ConfigFileNotFoundError
  | ConfigFileUnreadableError
  | ConfigFileInvalidError
  | ConfigFileUnsupportedError

export const readConfigDocument = Effect.fn('stryker.config.readDocument')(function*(input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly configEnv: ConfigEnv
}) {
  const cliRecord = yield* S.decodeEffect(ConfigDocumentSchema)(input.cliOptions).pipe(Effect.orDie)
  const fileOptions = yield* loadOptionsFromConfigFile(cliRecord, input.configEnv)
  return {
    document: mergeConfig(Option.getOrElse(fileOptions, () => ({})), cliRecord),
    fileFound: Option.isSome(fileOptions),
  }
})
