import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Array from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import { systemError } from 'effect/PlatformError'
import * as Result from 'effect/Result'

const Feature = makeFeature({ it })

const CONFIG_FIXTURES = `${globalThis.process.cwd()}/tests/__fixtures__/config-file`

const fixtureProject = (project: string): string => `${CONFIG_FIXTURES}/${project}`
const fixtureFile = (project: string, name: string): string => `${fixtureProject(project)}/${name}`

const MISSING_PACKAGE = '@acme/not-installed'

interface ReadRecorderShape {
  readonly warnings: string[]
}

class ReadRecorder extends Context.Service<ReadRecorder, ReadRecorderShape>()(
  '@systemfsoftware/stryker-js/tests/config-file.integration.test/ReadRecorder',
) {}

const makeRecorder = (): ReadRecorderShape => ({ warnings: [] })

const recorderLayer = Layer.effect(ReadRecorder, Effect.sync(makeRecorder))

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string
  existsSync(path: string): boolean
}

const nodeFs: NodeFs = globalThis.process.getBuiltinModule('node:fs')

const missingFileError = (path: string) =>
  systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'access', pathOrDescriptor: path })

const fileSystemLayer = FileSystem.layerNoop({
  readFileString: (path: string) => Effect.sync(() => nodeFs.readFileSync(path, 'utf8')),
  access: (path: string) =>
    Effect.sync(() => nodeFs.existsSync(path)).pipe(
      Effect.flatMap((present) =>
        Match.value(present).pipe(
          Match.when(true, () => Effect.void),
          Match.orElse(() => Effect.fail(missingFileError(path))),
        )
      ),
    ),
})

const warningLogger = <Message = unknown>(recorder: ReadRecorderShape): Logger.Logger<Message, void> =>
  Logger.make((options) => {
    recorder.warnings.push(Array.ensure(options.message).map(String).join(' '))
  })

const loggerLayer = Logger.layer([Effect.map(ReadRecorder, warningLogger)])

const configReadLayer = Layer.mergeAll(
  fileSystemLayer,
  Path.layer,
  recorderLayer,
  loggerLayer.pipe(Layer.provide(recorderLayer)),
)

type ConfigFileReadError =
  | Configuration.ConfigFileNotFoundError
  | Configuration.ConfigFileUnreadableError
  | Configuration.ConfigFileInvalidError
  | Configuration.ConfigFileUnsupportedError

interface ReadOutcome<E = ConfigFileReadError> {
  readonly result: Result.Result<Options.StrykerOptions, E>
  readonly recorder: ReadRecorderShape
}

type ReadEffect<A> = Effect.Effect<A, never, ReadRecorder | FileSystem.FileSystem | Path.Path>

const DEFAULT_INVOCATION: Configuration.ConfigInvocation = { command: 'run', mode: 'human' }

const outcomeOf = (
  cliOptions: Options.PartialStrykerOptions,
  invocation: Configuration.ConfigInvocation,
): ReadEffect<ReadOutcome> =>
  Effect.gen(function*() {
    const recorder = yield* ReadRecorder
    const result = yield* Effect.result(Configuration.readConfig(cliOptions, invocation))
    return { result, recorder }
  })

const readExplicit = (configFile: string): ReadEffect<ReadOutcome> => outcomeOf({ configFile }, DEFAULT_INVOCATION)

const readDiscovered = (project: string): ReadEffect<ReadOutcome> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(fixtureProject(project))
      return previous
    }),
    () => outcomeOf({}, DEFAULT_INVOCATION),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const optionsOrThrow = (outcome: ReadOutcome): Options.StrykerOptions => {
  if (Result.isFailure(outcome.result)) {
    throw new Error(`the config was expected to load, but it was refused: ${String(outcome.result.failure)}`)
  }
  return outcome.result.success
}

const isFailureRecord = (failure: unknown): failure is ConfigFileReadError =>
  typeof failure === 'object' && failure !== null && '_tag' in failure

const failureOrThrow = (outcome: ReadOutcome): ConfigFileReadError => {
  if (Result.isSuccess(outcome.result)) {
    throw new Error('the config read was expected to fail')
  }
  const failure = outcome.result.failure
  if (!isFailureRecord(failure)) {
    throw new Error(`the config read failed with a non-object: ${String(failure)}`)
  }
  return failure
}

const fileOf = (failure: ConfigFileReadError): string => failure.file

const hintOf = (failure: ConfigFileReadError): string =>
  'hint' in failure && typeof failure.hint === 'string' ? failure.hint : ''

const causeTextOf = (failure: ConfigFileReadError): string => {
  if (!('cause' in failure)) return ''
  return Match.value(failure.cause).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse((value) => String(value)),
  )
}

Feature('Configuring a Stryker run from a module config file')
  .withScenarioLayer(configReadLayer)
  .live(
    'the run loads config modules off the real filesystem through the module loader, which the kernel cannot settle',
  )
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A <format> config file configures the run',
      [
        { format: 'TypeScript', project: 'ts-project', file: 'stryker.config.ts', high: 91 },
        { format: 'TypeScript ESM', project: 'mts-project', file: 'stryker.config.mts', high: 92 },
        { format: 'ESM JavaScript', project: 'mjs-project', file: 'stryker.config.mjs', high: 93 },
        { format: 'JavaScript', project: 'js-project', file: 'stryker.config.js', high: 94 },
        {
          format: 'JavaScript beside a CommonJS package',
          project: 'js-cjs-project',
          file: 'stryker.config.js',
          high: 95,
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose only configuration is a config module')(
            'read',
            () => readExplicit(fixtureFile(row.project, row.file)),
          ),
          When('the run reads its configuration')(
            'seen',
            (s) => Effect.sync(() => ({ high: optionsOrThrow(s.read).thresholds.high })),
          ),
          Then('the run takes its settings from that module')((s, expect) => expect(s.seen.high).toEqual(row.high)),
        ),
    )

    scenario(
      'A project with a module config and a leftover legacy file uses the module config',
      Gherkin.Do.pipe(
        Given('a project holding both a module config and a leftover legacy JSON config')(
          'read',
          () => readDiscovered('shadowed-legacy'),
        ),
        When('the run discovers its configuration')(
          'seen',
          (s) =>
            Effect.sync(() => ({
              high: optionsOrThrow(s.read).thresholds.high,
              warnings: s.read.recorder.warnings,
            })),
        ),
        Then('the module config is used and the leftover file is reported as ignored')((s, expect) => {
          const ignoredFileWarned = s.seen.warnings.some(
            (warning) => warning.includes('stryker.conf.json') && warning.includes('stryker.config.ts'),
          )
          return expect({
            high: s.seen.high,
            warningCount: s.seen.warnings.length,
            ignoredFileWarned,
          }).toEqual({ high: 96, warningCount: 1, ignoredFileWarned: true })
        }),
      ),
    )

    scenarioOutline(
      'A project whose only configuration is a <kind> refuses to run and explains how to migrate',
      [
        { kind: 'legacy JSON file', project: 'legacy-only', file: 'stryker.config.json' },
        { kind: 'leftover CommonJS file', project: 'legacy-only-cjs', file: 'stryker.config.cjs' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose only configuration is a file in an abandoned format')(
            'read',
            () => readDiscovered(row.project),
          ),
          When('the run discovers its configuration')(
            'seen',
            (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
          ),
          Then('the run stops, names the abandoned file, and names the module formats to migrate to')((s, expect) => {
            const failure = s.seen.failure
            const hint = hintOf(failure)
            return expect({
              tag: failure['_tag'],
              exitClass: failure['exitClass'],
              namesTheAbandonedFile: fileOf(failure).endsWith(row.file),
              hintNamesLegacyFormats: hint.includes('JSON or CommonJS'),
              hintNamesEveryModuleFormat: ['.ts', '.mts', '.js', '.mjs'].every((extension) => hint.includes(extension)),
              hintNamesModuleDefaultExport: hint.includes('export default'),
            }).toEqual({
              tag: 'ConfigFileUnsupportedError',
              exitClass: 'ConfigError',
              namesTheAbandonedFile: true,
              hintNamesLegacyFormats: true,
              hintNamesEveryModuleFormat: true,
              hintNamesModuleDefaultExport: true,
            })
          }),
        ),
    )

    scenario(
      'Pointing a run at a legacy JSON file explicitly refuses to run and explains how to migrate',
      Gherkin.Do.pipe(
        Given('a run told which legacy JSON file to read')(
          'read',
          () => readExplicit(fixtureFile('legacy-only', 'stryker.config.json')),
        ),
        When('the run validates that path')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run stops before reading it, naming the file and the module formats to migrate to')((s, expect) => {
          const failure = s.seen.failure
          const hint = hintOf(failure)
          return expect({
            tag: failure['_tag'],
            namesTheLegacyFile: fileOf(failure).endsWith('stryker.config.json'),
            hintNamesLegacyFormats: hint.includes('JSON or CommonJS'),
            hintNamesModuleDefaultExport: hint.includes('export default'),
          }).toEqual({
            tag: 'ConfigFileUnsupportedError',
            namesTheLegacyFile: true,
            hintNamesLegacyFormats: true,
            hintNamesModuleDefaultExport: true,
          })
        }),
      ),
    )

    scenarioOutline(
      'Pointing a run at a <kind> refuses and lists the config formats that work',
      [
        { kind: 'file with no extension', project: 'extensionless', file: 'stryker-config' },
        { kind: 'file in an unknown format', project: 'not-a-config', file: 'stryker.config.yaml' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a run told which file to read')(
            'read',
            () => readExplicit(fixtureFile(row.project, row.file)),
          ),
          When('the run validates that path')(
            'seen',
            (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
          ),
          Then('the run stops with the formats that work, not with the migration text')((s, expect) => {
            const failure = s.seen.failure
            const hint = hintOf(failure)
            return expect({
              tag: failure['_tag'],
              namesTheUnreadableFile: fileOf(failure).endsWith(row.file),
              hintNamesEveryModuleFormat: ['.ts', '.mts', '.js', '.mjs'].every((extension) => hint.includes(extension)),
              hintNamesLegacyFormats: hint.includes('JSON or CommonJS'),
            }).toEqual({
              tag: 'ConfigFileUnsupportedError',
              namesTheUnreadableFile: true,
              hintNamesEveryModuleFormat: true,
              hintNamesLegacyFormats: false,
            })
          }),
        ),
    )

    scenario(
      'A config file that inherits from a legacy JSON file refuses and explains how to migrate',
      Gherkin.Do.pipe(
        Given('a config module inheriting from a legacy JSON file')(
          'read',
          () => readExplicit(fixtureFile('extends-json', 'stryker.config.ts')),
        ),
        When('the run follows the inheritance')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run stops, names the inherited file, and names the module formats to migrate to')((s, expect) => {
          const failure = s.seen.failure
          const hint = hintOf(failure)
          return expect({
            tag: failure['_tag'],
            namesTheInheritedFile: fileOf(failure).endsWith('base.json'),
            hintNamesExtends: hint.includes('extends'),
            hintNamesMjs: hint.includes('.mjs'),
          }).toEqual({
            tag: 'ConfigFileUnsupportedError',
            namesTheInheritedFile: true,
            hintNamesExtends: true,
            hintNamesMjs: true,
          })
        }),
      ),
    )

    scenario(
      'A config file inherits settings from another config module one level deep',
      Gherkin.Do.pipe(
        Given('a config module inheriting settings from another config module')(
          'read',
          () => readExplicit(fixtureFile('extends-ts', 'stryker.config.ts')),
        ),
        When('the run follows the inheritance')(
          'seen',
          (s) =>
            Effect.sync(() => {
              const thresholds = optionsOrThrow(s.read).thresholds
              return { high: thresholds.high, low: thresholds.low, break: thresholds.break }
            }),
        ),
        Then('the inherited settings fill in below the settings of the inheriting file')((s, expect) =>
          expect(s.seen).toEqual({ high: 71, low: 41, break: 31 })
        ),
      ),
    )

    scenario(
      'A config file that names its own plugins keeps the inherited ones as well',
      Gherkin.Do.pipe(
        Given('a config module that names plugins while inheriting from one that names others')(
          'read',
          () => readExplicit(fixtureFile('extends-ts', 'stryker.config.ts')),
        ),
        When('the run follows the inheritance')(
          'seen',
          (s) => Effect.sync(() => ({ plugins: optionsOrThrow(s.read).plugins })),
        ),
        Then('the run uses the inherited plugins followed by the ones the file names itself')((s, expect) =>
          expect(s.seen.plugins).toEqual(['file:///acme/inherited/index.mjs', 'file:///acme/explicit/index.mjs'])
        ),
      ),
    )

    scenario(
      'A config file that inherits from a package that is not installed refuses, naming the package',
      Gherkin.Do.pipe(
        Given('a config module inheriting from a package that is not installed')(
          'read',
          () => readExplicit(fixtureFile('unresolvable-extends', 'stryker.config.ts')),
        ),
        When('the run tries to resolve the package')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run stops, naming the package it could not find')((s, expect) => {
          const failure = s.seen.failure
          return expect({
            tag: failure['_tag'],
            namesThePackage: fileOf(failure),
            causeNamesThePackage: causeTextOf(failure).includes(MISSING_PACKAGE),
          }).toEqual({ tag: 'ConfigFileUnreadableError', namesThePackage: MISSING_PACKAGE, causeNamesThePackage: true })
        }),
      ),
    )

    scenario(
      'A config file that fails while loading refuses as unreadable',
      Gherkin.Do.pipe(
        Given('a config module that fails while it is loaded')(
          'read',
          () => readExplicit(fixtureFile('throws-on-load', 'stryker.config.ts')),
        ),
        When('the run loads it')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run stops, naming the config file it could not load')((s, expect) => {
          const failure = s.seen.failure
          return expect({
            tag: failure['_tag'],
            namesTheConfigFile: fileOf(failure).endsWith('stryker.config.ts'),
            causeNamesTheConfigFile: causeTextOf(failure).includes('stryker.config.ts'),
          }).toEqual({
            tag: 'ConfigFileUnreadableError',
            namesTheConfigFile: true,
            causeNamesTheConfigFile: true,
          })
        }),
      ),
    )

    scenario(
      'A config file whose settings are not a settings object refuses as invalid',
      Gherkin.Do.pipe(
        Given('a config module producing a number instead of settings')(
          'read',
          () => readExplicit(fixtureFile('malformed-default', 'stryker.config.ts')),
        ),
        When('the run reads it')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run reports an invalid configuration')((s, expect) => {
          const failure = s.seen.failure
          return expect({
            tag: failure['_tag'],
            namesTheConfigFile: fileOf(failure).endsWith('stryker.config.ts'),
            causeNamesTheDefaultExport: causeTextOf(failure).toLowerCase().includes('default export'),
          }).toEqual({
            tag: 'ConfigFileInvalidError',
            namesTheConfigFile: true,
            causeNamesTheDefaultExport: true,
          })
        }),
      ),
    )

    scenario(
      'Pointing a run at a config file that is not there refuses before loading anything',
      Gherkin.Do.pipe(
        Given('a run pointed at a config file that does not exist')(
          'read',
          () => readExplicit(fixtureFile('ts-project', 'stryker.config.missing.ts')),
        ),
        When('the run checks that path')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run reports the file as not found')((s, expect) => {
          const failure = s.seen.failure
          return expect({
            tag: failure['_tag'],
            namesTheMissingFile: fileOf(failure).endsWith('stryker.config.missing.ts'),
          }).toEqual({ tag: 'ConfigFileNotFoundError', namesTheMissingFile: true })
        }),
      ),
    )

    scenario(
      'An empty config module runs on the default settings',
      Gherkin.Do.pipe(
        Given('a config module with no settings')(
          'read',
          () => readExplicit(fixtureFile('empty-config', 'stryker.config.ts')),
        ),
        When('the run reads it')(
          'seen',
          (s) => Effect.sync(() => ({ high: optionsOrThrow(s.read).thresholds.high })),
        ),
        Then('every setting keeps its default value')((s, expect) => expect(s.seen.high).toEqual(80)),
      ),
    )

    scenario(
      'An empty config module keeps the mutation settings empty',
      Gherkin.Do.pipe(
        Given('a config module with no settings')(
          'read',
          () => readExplicit(fixtureFile('empty-config', 'stryker.config.ts')),
        ),
        When('the run reads it')(
          'seen',
          (s) => Effect.sync(() => ({ mutations: optionsOrThrow(s.read).mutator })),
        ),
        Then('nothing is excluded from mutation and nothing extra is opted into')((s, expect) =>
          expect(s.seen.mutations).toEqual({ excludedMutations: [], optInMutations: [] })
        ),
      ),
    )

    scenario(
      'A config module that opts into extra mutations keeps them exactly as written',
      Gherkin.Do.pipe(
        Given('a config module opting into the extra mutations it names')(
          'read',
          () => readExplicit(fixtureFile('opt-in-mutators', 'stryker.config.ts')),
        ),
        When('the run reads its configuration')(
          'seen',
          (s) => Effect.sync(() => ({ optedInto: optionsOrThrow(s.read).mutator.optInMutations })),
        ),
        Then('the run opts into exactly the names the file listed, in order')((s, expect) =>
          expect(s.seen.optedInto).toEqual(['FinalizerEscape'])
        ),
      ),
    )

    scenario(
      'A config module that derives its settings from how the run was invoked is handed those details',
      Gherkin.Do.pipe(
        Given('a project whose config module derives its settings from how the run was invoked')(
          'read',
          () =>
            outcomeOf({ configFile: fixtureFile('factory-config', 'stryker.config.ts') }, {
              command: 'run',
              mode: 'machine',
            }),
        ),
        When('the run reads its configuration for machine-readable output')(
          'seen',
          (s) =>
            Effect.sync(() => {
              const options = optionsOrThrow(s.read)
              return { high: options.thresholds.high, low: options.thresholds.low }
            }),
        ),
        Then('the run uses the settings that module derived for this invocation')((s, expect) =>
          expect(s.seen).toEqual({ high: 97, low: 10 })
        ),
      ),
    )

    scenario(
      'A config module that supplies its settings asynchronously is waited for',
      Gherkin.Do.pipe(
        Given('a project whose config module supplies its settings asynchronously')(
          'read',
          () => readExplicit(fixtureFile('promise-config', 'stryker.config.ts')),
        ),
        When('the run reads its configuration')(
          'seen',
          (s) => Effect.sync(() => ({ high: optionsOrThrow(s.read).thresholds.high })),
        ),
        Then('the run uses the settings that module supplied')((s, expect) => expect(s.seen.high).toEqual(95)),
      ),
    )
  })
