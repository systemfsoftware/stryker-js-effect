import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { readConfig } from '@systemfsoftware/stryker-js-engine'
import type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { Module } from '@systemfsoftware/stryker-js-language'
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
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const CONFIG_FIXTURES = `${process.cwd()}/tests/__fixtures__/config-file`

const fixtureProject = (project: string): string => `${CONFIG_FIXTURES}/${project}`
const fixtureFile = (project: string, name: string): string => `${fixtureProject(project)}/${name}`

const MISSING_PACKAGE = '@acme/not-installed'
const UNSHAPED_PACKAGE = '@acme/unshaped-config'
const SHARED_CONFIG_PACKAGE = '@acme/shared-stryker-config'

const INSTALLED_CONFIG_PACKAGES: Readonly<Record<string, string>> = {
  [UNSHAPED_PACKAGE]: fixtureFile('unshaped-extends', 'unshaped-config/package.json'),
  [SHARED_CONFIG_PACKAGE]: fixtureFile('bare-extends', 'shared-config/package.json'),
}

interface ReadRecorderShape {
  readonly attempted: string[]
  readonly bases: string[]
  readonly warnings: string[]
}

class ReadRecorder extends Context.Service<ReadRecorder, ReadRecorderShape>()(
  'stryker-js-engine/tests/ReadRecorder',
) {}

const makeRecorder = (): ReadRecorderShape => ({ attempted: [], bases: [], warnings: [] })

const recorderLayer = Layer.effect(ReadRecorder, Effect.sync(makeRecorder))

const moduleLayer = Layer.effect(
  Module,
  Effect.map(ReadRecorder, (recorder) => ({
    findPackageJSON: (specifier: string, base: string): string | undefined => {
      recorder.attempted.push(specifier)
      recorder.bases.push(base)
      return INSTALLED_CONFIG_PACKAGES[specifier]
    },
  })),
)

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string
  existsSync(path: string): boolean
}

const nodeFs: NodeFs = process.getBuiltinModule('node:fs')

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

const warningLogger = (recorder: ReadRecorderShape): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    recorder.warnings.push(Array.ensure(options.message).map(String).join(' '))
  })

const loggerLayer = Logger.layer([Effect.map(ReadRecorder, warningLogger)])

const configReadLayer = Layer.mergeAll(recorderLayer, moduleLayer, fileSystemLayer, Path.layer, loggerLayer).pipe(
  Layer.provideMerge(recorderLayer),
)

interface ReadOutcome {
  readonly result: Result.Result<StrykerOptions, unknown>
  readonly recorder: ReadRecorderShape
}

type ReadEffect<A> = Effect.Effect<A, never, ReadRecorder | Module | FileSystem.FileSystem | Path.Path>

const outcomeOf = (cliOptions: PartialStrykerOptions): ReadEffect<ReadOutcome> =>
  Effect.gen(function*() {
    const recorder = yield* ReadRecorder
    const result = yield* Effect.result(readConfig(cliOptions, process.cwd()))
    return { result, recorder }
  })

const readExplicit = (configFile: string): ReadEffect<ReadOutcome> => outcomeOf({ configFile })

const readDiscovered = (project: string): ReadEffect<ReadOutcome> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(fixtureProject(project))
      return previous
    }),
    () => outcomeOf({}),
    (previous) =>
      Effect.sync(() => {
        process.chdir(previous)
      }),
  )

const optionsOrThrow = (outcome: ReadOutcome): StrykerOptions => {
  if (Result.isFailure(outcome.result)) {
    throw new Error(`the config was expected to load, but it was refused: ${String(outcome.result.failure)}`)
  }
  return outcome.result.success
}

const isFailureRecord = (failure: unknown): failure is Record<string, unknown> =>
  typeof failure === 'object' && failure !== null

const failureOrThrow = (outcome: ReadOutcome): Record<string, unknown> => {
  if (Result.isSuccess(outcome.result)) {
    throw new Error('the config read was expected to fail')
  }
  const failure = outcome.result.failure
  if (!isFailureRecord(failure)) {
    throw new Error(`the config read failed with a non-object: ${String(failure)}`)
  }
  return failure
}

const fileOf = (failure: Record<string, unknown>): string => String(failure['file'])

const hintOf = (failure: Record<string, unknown>): string => String(failure['hint'])

const causeTextOf = (failure: Record<string, unknown>): string =>
  Match.value(failure['cause']).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse((value) => String(value)),
  )

Feature('Configuring a Stryker run from a module config file')
  .withScenarioLayer(configReadLayer)
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
            (s) =>
              Effect.sync(() => ({
                high: optionsOrThrow(s.read).thresholds.high,
                attempted: s.read.recorder.attempted,
              })),
          ),
          Then('the run is configured by that module, with nothing resolved as a package')((s) => {
            expect(s.seen.high).toBe(row.high)
            expect(s.seen.attempted).toStrictEqual([])
          }),
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
        Then('the module config is used and the leftover file is reported as ignored')((s) => {
          expect(s.seen.high).toBe(96)
          expect(s.seen.warnings).toHaveLength(1)
          expect(s.seen.warnings[0]).toContain('stryker.conf.json')
          expect(s.seen.warnings[0]).toContain('stryker.config.ts')
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
          Then('the run stops, names the abandoned file, and names the module formats to migrate to')((s) => {
            expect(s.seen.failure['_tag']).toBe('ConfigFileUnsupportedError')
            expect(s.seen.failure['exitClass']).toBe('ConfigError')
            expect(fileOf(s.seen.failure).endsWith(row.file)).toBe(true)
            expect(hintOf(s.seen.failure)).toContain('JSON or CommonJS')
            expect(hintOf(s.seen.failure)).toContain('.ts')
            expect(hintOf(s.seen.failure)).toContain('.mts')
            expect(hintOf(s.seen.failure)).toContain('.js')
            expect(hintOf(s.seen.failure)).toContain('.mjs')
            expect(hintOf(s.seen.failure)).toContain('export default')
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
        Then('the run stops before reading it, naming the file and the module formats to migrate to')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileUnsupportedError')
          expect(fileOf(s.seen.failure).endsWith('stryker.config.json')).toBe(true)
          expect(hintOf(s.seen.failure)).toContain('JSON or CommonJS')
          expect(hintOf(s.seen.failure)).toContain('export default')
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
          Then('the run stops with the formats that work, not with the migration text')((s) => {
            expect(s.seen.failure['_tag']).toBe('ConfigFileUnsupportedError')
            expect(fileOf(s.seen.failure).endsWith(row.file)).toBe(true)
            expect(hintOf(s.seen.failure)).toContain('.ts')
            expect(hintOf(s.seen.failure)).toContain('.mts')
            expect(hintOf(s.seen.failure)).toContain('.js')
            expect(hintOf(s.seen.failure)).toContain('.mjs')
            expect(hintOf(s.seen.failure)).not.toContain('JSON or CommonJS')
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
        Then('the run stops, names the inherited file, and names the module formats to migrate to')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileUnsupportedError')
          expect(fileOf(s.seen.failure).endsWith('base.json')).toBe(true)
          expect(hintOf(s.seen.failure)).toContain('extends')
          expect(hintOf(s.seen.failure)).toContain('.mjs')
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
        Then('the inherited settings fill in below the settings of the inheriting file')((s) => {
          expect(s.seen).toStrictEqual({ high: 71, low: 41, break: 31 })
        }),
      ),
    )

    scenario(
      'A config file inherits settings from an installed config package',
      Gherkin.Do.pipe(
        Given('a config module inheriting from a config package installed in the project')(
          'read',
          () => readExplicit(fixtureFile('bare-extends', 'stryker.config.ts')),
        ),
        When('the run resolves the package and reads its entry')(
          'seen',
          (s) =>
            Effect.sync(() => ({
              high: optionsOrThrow(s.read).thresholds.high,
              attempted: s.read.recorder.attempted,
              bases: s.read.recorder.bases,
            })),
        ),
        Then('the package settings configure the run, resolved from the project the config lives in')((s) => {
          expect(s.seen.high).toBe(81)
          expect(s.seen.attempted).toStrictEqual([SHARED_CONFIG_PACKAGE])
          expect(s.seen.bases).toStrictEqual([fixtureFile('bare-extends', 'package.json')])
        }),
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
        Then('the run stops, naming the package it could not find')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileUnreadableError')
          expect(fileOf(s.seen.failure)).toBe(MISSING_PACKAGE)
          expect(causeTextOf(s.seen.failure)).toContain(MISSING_PACKAGE)
        }),
      ),
    )

    scenario(
      'A config file that inherits from a package with no usable entry refuses',
      Gherkin.Do.pipe(
        Given('a config module inheriting from a package whose manifest names no entry')(
          'read',
          () => readExplicit(fixtureFile('unshaped-extends', 'stryker.config.ts')),
        ),
        When('the run reads the package manifest')(
          'seen',
          (s) => Effect.sync(() => ({ failure: failureOrThrow(s.read) })),
        ),
        Then('the run stops and reports the manifest as unusable')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileUnreadableError')
          expect(fileOf(s.seen.failure)).toBe(UNSHAPED_PACKAGE)
          expect(causeTextOf(s.seen.failure)).toContain('no-main-no-exports')
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
        Then('the run stops, naming the config file it could not load')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileUnreadableError')
          expect(fileOf(s.seen.failure).endsWith('stryker.config.ts')).toBe(true)
          expect(causeTextOf(s.seen.failure)).toContain('stryker.config.ts')
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
        Then('the run reports an invalid configuration')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileInvalidError')
          expect(fileOf(s.seen.failure).endsWith('stryker.config.ts')).toBe(true)
          expect(causeTextOf(s.seen.failure).toLowerCase()).toContain('default export')
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
        Then('the run reports the file as not found')((s) => {
          expect(s.seen.failure['_tag']).toBe('ConfigFileNotFoundError')
          expect(fileOf(s.seen.failure).endsWith('stryker.config.missing.ts')).toBe(true)
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
        Then('every setting keeps its default value')((s) => {
          expect(s.seen.high).toBe(80)
        }),
      ),
    )
  })
