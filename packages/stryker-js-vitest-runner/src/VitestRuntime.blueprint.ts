import { createVitest as createVitestOriginal, type Vitest } from 'vitest/node'

import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'

import { onClose } from './drivers/vitest-node.js'
import {
  dispose as disposeStandbyThreads,
  initializer as standbyThreadsInitializer,
  make as makeStandbyThreadsPool,
  type StandbyThreadsPool,
} from './StandbyThreadsPool.handle.js'
import { type RawVitestRecord } from './vitest-run-command.schema.js'
import {
  type ExportEntry,
  PackageManifest,
  type StrykerNamespace,
  type VitestRunnerOptions,
} from './VitestRunner.schema.js'
import { close, failRuntime, make, type VitestRuntime } from './VitestRuntime.handle.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-vitest-runner/VitestRuntime')
export type TypeId = typeof TypeId

const STRYKER_SETUP_URL = new URL('./stryker-setup.mjs', import.meta.url)

const parseJson = (text: string): Option.Option<RawVitestRecord> =>
  S.decodeOption(S.fromJsonString(S.Record(S.String, S.Unknown)))(text)

const TYPESCRIPT_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts'] as const

const isTypescriptSourcePath = (filePath: string): boolean =>
  TYPESCRIPT_SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension))

const typescriptSourcePath = (filePath: string): string | undefined =>
  Option.getOrUndefined(Option.filter(Option.some(filePath), isTypescriptSourcePath))

const sourceTargetOf = (entry: ExportEntry): string | undefined =>
  Match.value(entry).pipe(
    Match.when(Match.string, (filePath) => typescriptSourcePath(filePath)),
    Match.orElse((): string | undefined => undefined),
  )

const subpathSpecifier = (packageName: string, exportKey: string): string | undefined =>
  Match.value(exportKey.startsWith('./')).pipe(
    Match.when(true, () => `${packageName}/${exportKey.slice(2)}`),
    Match.orElse((): string | undefined => undefined),
  )

const specifierForExport = (packageName: string, exportKey: string): string | undefined =>
  Match.value(exportKey).pipe(
    Match.when('.', () => packageName),
    Match.when('./package.json', () => undefined),
    Match.orElse((key) => subpathSpecifier(packageName, key)),
  )

const namedExports = (
  manifest: PackageManifest,
): Option.Option<{ readonly name: string; readonly exports: Record<string, ExportEntry> }> =>
  Option.flatMap(
    Option.filter(Option.fromNullishOr(manifest.name), (name) => name.length > 0),
    (name) => Option.map(Option.fromNullishOr(manifest.exports), (exportMap) => ({ name, exports: exportMap })),
  )

const exportAlias = (
  packageName: string,
  projectRoot: string,
  pathService: Path.Path,
  [exportKey, entry]: readonly [string, ExportEntry],
): Option.Option<SandboxAlias> =>
  Option.flatMap(
    Option.fromNullishOr(specifierForExport(packageName, exportKey)),
    (spec) =>
      Option.map(Option.fromNullishOr(sourceTargetOf(entry)), (target) => ({
        find: new RegExp(`^${RegExp.escape(spec)}$`),
        replacement: pathService.resolve(projectRoot, target),
      })),
  )

const sandboxSelfAliases = (
  manifest: PackageManifest,
  projectRoot: string,
  pathService: Path.Path,
): readonly SandboxAlias[] =>
  Option.match(namedExports(manifest), {
    onNone: (): readonly SandboxAlias[] => [],
    onSome: ({ name, exports: exportMap }) =>
      Object.entries(exportMap).flatMap((entry) => Option.toArray(exportAlias(name, projectRoot, pathService, entry))),
  })

export interface SandboxAlias {
  readonly find: RegExp
  readonly replacement: string
}

const noAliases: readonly SandboxAlias[] = []

export const sandboxSelfPlugin = (
  aliases: readonly SandboxAlias[],
): { readonly name: string; readonly enforce: 'pre'; readonly resolveId: (source: string) => string | undefined } => ({
  name: 'stryker-sandbox-self-exports',
  enforce: 'pre',
  resolveId(source: string): string | undefined {
    return Option.getOrUndefined(
      Option.map(
        Option.fromNullishOr(aliases.find((alias) => alias.find.test(source))),
        (alias) => alias.replacement,
      ),
    )
  },
})

const readSandboxSelfAliases = Effect.fn('vitest.runtime.read_sandbox_self_aliases')(
  function*(projectRoot: string, fs: FileSystem.FileSystem, pathService: Path.Path) {
    const raw = yield* fs.readFileString(pathService.join(projectRoot, 'package.json')).pipe(
      Effect.orElseSucceed(() => null),
    )
    return Option.flatMap(Option.fromNullishOr(raw), (content) => parseJson(content)).pipe(
      Option.flatMap((manifest) => S.decodeOption(PackageManifest)(manifest)),
      Option.match({
        onNone: () => noAliases,
        onSome: (manifest) => sandboxSelfAliases(manifest, projectRoot, pathService),
      }),
    )
  },
)

export interface ResolvedVitest {
  createVitest: typeof createVitestOriginal
}

export type VitestResolver = (dir: string) => Effect.Effect<ResolvedVitest>

const vitestUnresolved = (specifier: string, base: string, detail: string): TestRunner.TestRunnerFailed =>
  new TestRunner.TestRunnerFailed({
    runnerName: 'vitest',
    phase: 'init',
    cause: `Cannot resolve "${specifier}" from "${base}": ${detail}`,
  })

const hasCreateVitest = (
  value: object,
): value is { readonly createVitest: ResolvedVitest['createVitest'] } =>
  Predicate.hasProperty(value, 'createVitest') && Predicate.isFunction(value['createVitest'])

const isVitestNodeModule = (
  value: unknown,
): value is { readonly createVitest: ResolvedVitest['createVitest'] } =>
  Predicate.isObject(value) && hasCreateVitest(value)

export const resolveVitest: VitestResolver = (_dir) => {
  const fallback = Effect.succeed({ createVitest: createVitestOriginal })
  const primary = Effect.gen(function*() {
    const resolutionFailure = (specifier: string, detail: string): TestRunner.TestRunnerFailed =>
      vitestUnresolved(specifier, import.meta.url, detail)
    const resolveSpecifier = (specifier: string): Effect.Effect<string, TestRunner.TestRunnerFailed> =>
      Effect.try<string, TestRunner.TestRunnerFailed>({
        try: () => import.meta.resolve(specifier),
        catch: (cause) =>
          resolutionFailure(
            specifier,
            Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
          ),
      })
    const vitestNodeUrl = yield* resolveSpecifier('vitest/node')
    const imported = yield* Effect.tryPromise({
      try: (): Promise<object> => import(vitestNodeUrl),
      catch: (cause) =>
        resolutionFailure(
          'vitest/node',
          Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
        ),
    })
    return yield* Option.match(
      Option.liftPredicate(
        Option.getOrUndefined(
          S.decodeUnknownOption(
            S.Record(S.String, S.Unknown),
          )(imported),
        ),
        isVitestNodeModule,
      ),
      {
        onNone: () =>
          Effect.fail(resolutionFailure('vitest/node', 'Missing createVitest export on vitest/node module')),
        onSome: (module) => Effect.succeed({ createVitest: module.createVitest }),
      },
    )
  })
  return primary.pipe(Effect.catchCause(() => fallback), Effect.catchDefect(() => fallback), Effect.orDie)
}

export interface VitestRuntimeInput {
  readonly projectRoot: string
  readonly vitestOptions: VitestRunnerOptions
  readonly namespace: StrykerNamespace
  readonly bail: number
  readonly setupFilePath: string | undefined
  readonly resolver: VitestResolver
  readonly crypto: Crypto.Crypto
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly lifetime: Scope.Scope
}

const createVitestConfig = (input: VitestRuntimeInput, standbyThreads: StandbyThreadsPool) => ({
  config: input.vitestOptions.configFile,
  coverage: { enabled: false },
  maxWorkers: 1,
  maxConcurrency: 1,
  watch: false,
  root: input.projectRoot,
  ...Option.match(
    Option.map(Option.fromNullishOr(input.vitestOptions.dir), (dir) => input.projectRoot + '/' + dir),
    { onNone: () => ({}), onSome: (dir) => ({ dir }) },
  ),
  ...Option.match(
    Option.fromNullishOr(input.vitestOptions.pool),
    { onNone: () => ({}), onSome: () => ({ pool: standbyThreadsInitializer(standbyThreads) }) },
  ),
  bail: input.bail,
  onConsoleLog: () => false,
  silent: true,
  reporters: [{ onInit(_vitest: Vitest) {} }],
})

const BROWSER_REFUSAL =
  "the vm runner runs Vitest's isolated `threads` pool, which cannot run browser-mode projects; set `testRunner: 'vitest'` to run them"

const browserRefusalOf = (driver: Vitest): Option.Option<string> =>
  Option.liftPredicate(
    driver.config.browser.enabled || driver.projects.some((project) => project.config.browser.enabled),
    (enabled) => enabled,
  ).pipe(Option.as(BROWSER_REFUSAL))

const closeAfterFailure = (runtime: VitestRuntime, fs: FileSystem.FileSystem): Effect.Effect<void> =>
  close(runtime).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.orElseSucceed(() => undefined),
    Effect.catchDefect(() => Effect.void),
  )

const refuseBrowser = (
  input: VitestRuntimeInput,
  driver: Vitest,
): Effect.Effect<void, TestRunner.TestRunnerFailed> =>
  Option.match(input.vitestOptions.pool === undefined ? Option.none<string>() : browserRefusalOf(driver), {
    onNone: () => Effect.void,
    onSome: (reason) => Effect.fail(failRuntime('init')(reason)),
  })

const openRuntime = Effect.fn('vitest.runtime.open')(function*(
  input: VitestRuntimeInput,
  localSetupFile: string,
) {
  const { fileSystem: fs, path } = input
  const aliases = yield* readSandboxSelfAliases(input.projectRoot, fs, path)
  const { createVitest } = yield* input.resolver(input.projectRoot).pipe(
    Effect.catchDefect((cause) => Effect.fail(failRuntime('init')(cause))),
  )
  const standbyThreads = yield* makeStandbyThreadsPool().pipe(Scope.provide(input.lifetime))
  const driver = yield* Effect.tryPromise({
    try: () =>
      createVitest('test', createVitestConfig(input, standbyThreads), {
        resolve: { alias: [...aliases], conditions: ['import'] },
        plugins: [sandboxSelfPlugin(aliases)],
      }),
    catch: (cause) => failRuntime('init')(cause),
  })
  onClose(driver, disposeStandbyThreads(standbyThreads))
  const runtime = make({
    driver,
    projectRoot: input.projectRoot,
    localSetupFile,
    namespace: input.namespace,
    mutantBail: input.bail,
  })
  yield* refuseBrowser(input, driver).pipe(Effect.onError(() => closeAfterFailure(runtime, fs)))
  return runtime
})

const acquire: (input: VitestRuntimeInput) => Effect.Effect<VitestRuntime, TestRunner.TestRunnerFailed> = Effect.fn(
  'vitest.runtime.acquire',
)(function*(input: VitestRuntimeInput) {
  const { crypto, fileSystem: fs, path } = input
  const suffix = yield* crypto.randomUUIDv4.pipe(Effect.mapError(failRuntime('init')))
  const localSetupFile = path.resolve(input.projectRoot, 'stryker-setup-' + suffix + '.js')
  const setupFilePath = yield* Option.match(Option.fromNullishOr(input.setupFilePath), {
    onNone: () => path.fromFileUrl(STRYKER_SETUP_URL).pipe(Effect.mapError(failRuntime('init'))),
    onSome: Effect.succeed,
  })
  yield* fs.copyFile(setupFilePath, localSetupFile).pipe(Effect.mapError(failRuntime('init')))
  return yield* openRuntime(input, localSetupFile).pipe(
    Effect.onError(() =>
      fs.remove(localSetupFile, { recursive: true, force: true }).pipe(Effect.orElseSucceed(() => undefined))
    ),
  )
})

const VitestRuntimeBlueprint = Blueprint.make<VitestRuntimeInput>()(TypeId).steps({
  steps: {},
  targets: { create: acquire },
})

export type VitestRuntimeBlueprint = Blueprint.Of<typeof VitestRuntimeBlueprint>

export const of = VitestRuntimeBlueprint.of

export const create = (input: VitestRuntimeInput): Effect.Effect<VitestRuntime, TestRunner.TestRunnerFailed> =>
  of(input).create
