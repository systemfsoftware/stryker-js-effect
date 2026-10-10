import {
  Array as Arr,
  Boolean,
  Clock,
  Console,
  Context,
  Duration,
  Effect,
  FileSystem,
  Match,
  Option,
  Path,
  Ref,
  Result,
  Schema as S,
  Stream,
} from 'effect'
import type { BadArgument, PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
  type BenchEnterpriseCorpus,
  type BenchRepoEntry,
  type BenchSide,
  FixtureManifest,
  installClosure,
  InstallClosureCommand,
  type LockfilePins,
  lockfilePins,
  LockfilePinsCommand,
  ManifestDocument,
  PackedManifest,
  type PackedMember,
  parseWorkspaceCatalogs,
  pinnedManifest,
  PnpmListingJson,
  resolvedManifestText,
  type SetupFailure,
  type SetupFailureKind,
  setupRecoveryOf,
  type SetupStep,
  type StagedFixtureManifest,
  type WorkspaceCatalogs,
} from '@systemfsoftware/stryker-e2e-core'

import type { BenchTarget } from './bench-target.schema.js'
import {
  BenchSetupFailed,
  PackageEntrypoints,
  TurboDryRun,
  type TurboTask,
  WorkspaceListing,
} from './prepare-side.schema.js'
import type { PreparedSide } from './prepared-side.js'

export interface PrepareSideInput {
  readonly side: BenchSide
  readonly root: string
  readonly fixtureSource: string
  readonly workDir: string
  readonly target: BenchTarget
  readonly turboCacheDir: string
  readonly deadlineMs: number
}

type SetupCause = PlatformError | BadArgument | S.SchemaError

class SetupOutput extends Context.Service<SetupOutput, Ref.Ref<string>>()(
  '@systemfsoftware/stryker-bench/prepare-side.service/SetupOutput',
) {}

type BenchPlatform = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

type StepPlatform = BenchPlatform | SetupOutput

type Argv = readonly [string, ...ReadonlyArray<string>]

interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface PackedTarball {
  readonly fileName: string
  readonly tarballPath: string
}

interface StepRun<A> {
  readonly value: A
  readonly step: SetupStep
  readonly retried: Option.Option<string>
}

interface StepSpec {
  readonly name: string
  readonly capMs: Option.Option<number>
}

const BENCH_CONFIG_FILE = 'stryker.bench.config.ts'
const MANIFEST_FILE_NAME = 'package.json'
const WORKSPACE_CATALOGS_FILE = 'pnpm-workspace.yaml'
const STDERR_TAIL_CHARS = 4000
const PACKED_MANIFEST_PATH = 'package/package.json'
const CLI_BUILD_FILTER = '@systemfsoftware/stryker-js'
const TYPESCRIPT_CHECKER_BUILD_FILTER = '@systemfsoftware/stryker-js-typescript-checker'
const CLI_MAIN_RELATIVE = ['packages', 'stryker-js', 'dist', 'main.mjs'] as const
const ENTERPRISE_CLI_RELATIVE = ['node_modules', '@systemfsoftware', 'stryker-js', 'dist', 'main.mjs'] as const

const VITEST_RUNNER_DIR = 'packages/stryker-js-vitest-runner'
const TYPESCRIPT_CHECKER_DIR = 'packages/stryker-js-typescript-checker'
const IGNORER_DIRS = [
  'packages/ignorers/effect-schema-declarations',
  'packages/ignorers/in-source-vitest-block',
] as const

const ENGINE_BUILD_DIRS = ['packages/stryker-js', VITEST_RUNNER_DIR, TYPESCRIPT_CHECKER_DIR, ...IGNORER_DIRS] as const

const STEP_REPO_BUILD: StepSpec = { name: 'turbo build the repo corpus projects', capMs: Option.some(90_000) }
const STEP_CONFIGS: StepSpec = { name: 'write the per-entry bench configs', capMs: Option.none() }
const STEP_ENTERPRISE_MANIFESTS: StepSpec = {
  name: 'resolve the enterprise fixture catalogs',
  capMs: Option.none(),
}
const STEP_ENTERPRISE_CLOSURE: StepSpec = { name: 'build and pack the enterprise closure', capMs: Option.some(90_000) }
const STEP_ENTERPRISE_INSTALL: StepSpec = { name: 'install the enterprise fixture', capMs: Option.some(75_000) }

const PACKED_VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

const packedFileNameOf = (prefix: string): RegExp =>
  new RegExp(`^${prefix.replace(REGEXP_SPECIAL, String.raw`\$&`)}(${PACKED_VERSION})\\.tgz$`)

const fail = (step: StepSpec, detail: string, cause?: SetupCause): BenchSetupFailed =>
  cause === undefined
    ? BenchSetupFailed.make({ step: step.name, detail })
    : BenchSetupFailed.make({ step: step.name, detail, cause })

const sideLabel = (side: BenchSide): string => `side ${side}`

const tailOf = (text: string): string => text.slice(-STDERR_TAIL_CHARS)

const runCommand = (
  step: StepSpec,
  argv: Argv,
  cwd?: string,
): Effect.Effect<CommandOutcome, BenchSetupFailed, StepPlatform> =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const output = yield* SetupOutput
    const [command, ...args] = argv
    const options = { forceKillAfter: Duration.seconds(10), ...(cwd === undefined ? {} : { cwd }) }
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, options)).pipe(
      Effect.mapError((cause) => fail(step, `${command} could not be started`, cause)),
    )
    const stdout = yield* Ref.make('')
    const stderr = yield* Ref.make('')
    const collect = (stream: typeof handle.stdout, into: Ref.Ref<string>) =>
      Stream.runForEach(
        Stream.decodeText(stream),
        (chunk) =>
          Ref.update(into, (text) => text + chunk).pipe(
            Effect.andThen(Ref.update(output, (tail) => tailOf(tail + chunk))),
          ),
      )
    const [exitCode] = yield* Effect.all(
      [handle.exitCode, collect(handle.stdout, stdout), collect(handle.stderr, stderr)] as const,
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.mapError((cause) => fail(step, `the output of ${command} could not be read`, cause)),
    )
    return { exitCode, stdout: yield* Ref.get(stdout), stderr: yield* Ref.get(stderr) }
  }))

const runChecked = (
  step: StepSpec,
  argv: Argv,
  cwd?: string,
): Effect.Effect<CommandOutcome, BenchSetupFailed, StepPlatform> =>
  Effect.filterOrFail(
    runCommand(step, argv, cwd),
    (outcome) => outcome.exitCode === 0,
    (outcome) => fail(step, `${argv.slice(0, 3).join(' ')} exited ${outcome.exitCode}`),
  )

const seconds = (ms: number): string => (ms / 1000).toFixed(1)

const failureOf = (
  kind: 'overran' | 'out-of-time',
  name: string,
  budgetMs: number,
  wasRetried: boolean,
  outputTail: string,
): SetupFailure => {
  const firstAttempt = Boolean.match(wasRetried, { onTrue: (): SetupFailureKind => 'exited', onFalse: () => kind })
  return Match.value(kind).pipe(
    Match.when('overran', (): SetupFailure => ({
      _tag: 'overran',
      step: name,
      firstAttempt,
      reason: `did not finish within its own ${seconds(budgetMs)}s deadline and was killed`,
      outputTail,
    })),
    Match.when('out-of-time', (): SetupFailure => ({
      _tag: 'out-of-time',
      step: name,
      firstAttempt,
      reason: `was still running when the job deadline came (${seconds(budgetMs)}s were left when it started)`,
      outputTail,
    })),
    Match.exhaustive,
  )
}

const runStep = <A, R>(
  label: string,
  spec: StepSpec,
  deadlineMs: number,
  attempt: Effect.Effect<A, BenchSetupFailed, R>,
): Effect.Effect<StepRun<A>, SetupFailure, Exclude<R, SetupOutput>> =>
  Effect.gen(function*() {
    const name = `${label} ${spec.name}`
    const output = yield* Ref.make('')
    const retried = yield* Ref.make(false)
    const leftMs = Math.max(0, deadlineMs - (yield* Clock.currentTimeMillis))
    const budgetMs = Option.match(spec.capMs, { onNone: () => leftMs, onSome: (capMs) => Math.min(capMs, leftMs) })
    const clipped = Option.match(spec.capMs, { onNone: () => true, onSome: (capMs) => leftMs < capMs })
    const once = Effect.provideService(attempt, SetupOutput, output)
    const withRetry = once.pipe(
      Effect.catch((first) =>
        Console.log(`bench setup retrying: ${name} after ${first.detail}`).pipe(
          Effect.andThen(Ref.set(retried, true)),
          Effect.andThen(once),
        )
      ),
    )
    yield* Console.log(`bench setup started: ${name} (deadline ${seconds(budgetMs)}s)`)
    const [elapsed, outcome] = yield* Effect.timed(
      Effect.result(Effect.timeoutOption(withRetry, Duration.millis(budgetMs))),
    )
    yield* Console.log(`bench setup finished: ${name} in ${Duration.format(elapsed)}`)
    const outputTail = yield* Ref.get(output)
    const wasRetried = yield* Ref.get(retried)
    return yield* Result.match(outcome, {
      onFailure: (failed): Effect.Effect<StepRun<A>, SetupFailure> =>
        Effect.fail({
          _tag: 'exited',
          step: spec.name,
          firstAttempt: 'exited',
          reason: `${name}: ${failed.detail}`,
          outputTail,
        }),
      onSuccess: (finished) =>
        Option.match(finished, {
          onNone: (): Effect.Effect<StepRun<A>, SetupFailure> =>
            Effect.fail(
              failureOf(
                Boolean.match(clipped, { onTrue: () => 'out-of-time', onFalse: () => 'overran' }),
                spec.name,
                budgetMs,
                wasRetried,
                outputTail,
              ),
            ),
          onSome: (value) =>
            Effect.succeed({
              value,
              step: { name, ms: Duration.toMillis(elapsed) },
              retried: Option.liftPredicate(spec.name, () => wasRetried),
            }),
        }),
    })
  })

const readCatalogs = (root: string): Effect.Effect<WorkspaceCatalogs, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, WORKSPACE_CATALOGS_FILE)).pipe(
      Effect.mapError((cause) =>
        fail(STEP_ENTERPRISE_MANIFESTS, `${WORKSPACE_CATALOGS_FILE} could not be read`, cause)
      ),
    )
    return parseWorkspaceCatalogs(text)
  })

const entryUrlOf = (root: string, project: string): Effect.Effect<string, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifestPath = path.join(root, project, MANIFEST_FILE_NAME)
    const text = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError((cause) => fail(STEP_CONFIGS, `${manifestPath} could not be read`, cause)),
    )
    const manifest = yield* S.decodeEffect(S.fromJsonString(PackageEntrypoints))(text).pipe(
      Effect.mapError((cause) =>
        fail(STEP_CONFIGS, `${manifestPath} has no exports["."].default build target to point the bench at`, cause)
      ),
    )
    const target = manifest.exports['.'].default
    const url = yield* path.toFileUrl(path.join(root, project, target)).pipe(
      Effect.mapError((cause) => fail(STEP_CONFIGS, `${target} could not be turned into a file URL`, cause)),
    )
    return url.href
  })

const testFilesLine = (testFiles: ReadonlyArray<string> | undefined): string =>
  Option.match(Option.fromUndefinedOr(testFiles), {
    onNone: () => '',
    onSome: (files) => `  testFiles: ${JSON.stringify(files)},\n`,
  })

const benchConfigSource = (input: {
  readonly vitestRunnerUrl: string
  readonly typescriptCheckerUrl: string
  readonly ignorerUrls: ReadonlyArray<string>
  readonly entry: BenchRepoEntry
}): string =>
  `import base from './stryker.config.ts'

const config = {
  ...base,
  testRunner: { ...base.testRunner, plugin: ${JSON.stringify(input.vitestRunnerUrl)} },
  checkers: (base.checkers ?? []).map((checker) => ({ ...checker, plugin: ${
    JSON.stringify(input.typescriptCheckerUrl)
  } })),
  ignorers: ${JSON.stringify(input.ignorerUrls)},
  mutate: ${JSON.stringify(input.entry.mutate)},
${testFilesLine(input.entry.testFiles)}  thresholds: { ...base.thresholds, break: null },
}

export default config
`

const enterpriseConfigSource = (corpus: BenchEnterpriseCorpus): string =>
  `import base from './${corpus.config}'

export default { ...base, mutate: ${JSON.stringify(corpus.mutate)} }
`

const writeRepoEntry = (
  input: PrepareSideInput,
  entry: BenchRepoEntry,
): Effect.Effect<string, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const vitestRunnerUrl = yield* entryUrlOf(input.root, VITEST_RUNNER_DIR)
    const typescriptCheckerUrl = yield* entryUrlOf(input.root, TYPESCRIPT_CHECKER_DIR)
    const ignorerUrls = yield* Effect.forEach(IGNORER_DIRS, (project) => entryUrlOf(input.root, project))
    const cwd = path.join(input.root, entry.project)
    const source = benchConfigSource({ vitestRunnerUrl, typescriptCheckerUrl, ignorerUrls, entry })
    yield* fs.writeFileString(path.join(cwd, BENCH_CONFIG_FILE), source).pipe(
      Effect.mapError((cause) =>
        fail(STEP_CONFIGS, `${entry.project}/${BENCH_CONFIG_FILE} could not be written`, cause)
      ),
    )
    return cwd
  })

const buildTaskNames = (task: TurboTask): ReadonlyArray<string> =>
  Boolean.match(task.command === 'build' || task.taskId.endsWith('#build'), {
    onTrue: () => Option.toArray(Option.fromUndefinedOr(task.package)),
    onFalse: () => [],
  })

const turboClosureOf = (stdout: string): Effect.Effect<ReadonlyArray<string>, BenchSetupFailed> =>
  Effect.gen(function*() {
    const start = stdout.indexOf('{')
    yield* Boolean.match(start < 0, {
      onTrue: () => Effect.fail(fail(STEP_ENTERPRISE_CLOSURE, 'the turbo dry run wrote no closure document')),
      onFalse: () => Effect.void,
    })
    const dryRun = yield* S.decodeEffect(S.fromJsonString(TurboDryRun))(stdout.slice(start)).pipe(
      Effect.mapError((cause) =>
        fail(STEP_ENTERPRISE_CLOSURE, 'the turbo dry run wrote no parseable closure document', cause)
      ),
    )
    return Arr.dedupe(dryRun.tasks.flatMap(buildTaskNames)).sort()
  })

const workspacePackages = (
  root: string,
): Effect.Effect<ReadonlyArray<string>, BenchSetupFailed, StepPlatform> =>
  Effect.gen(function*() {
    const listing = yield* runChecked(
      STEP_ENTERPRISE_INSTALL,
      ['pnpm', 'ls', '-r', '--depth', '-1', '--json'],
      root,
    )
    const projects = yield* S.decodeEffect(S.fromJsonString(S.Array(WorkspaceListing)))(listing.stdout).pipe(
      Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, 'pnpm ls wrote no parseable workspace listing', cause)),
    )
    return projects.flatMap((project) => Option.toArray(Option.fromUndefinedOr(project.name)))
  })

const packedTarballOf = (
  directory: string,
  packageName: string,
  fileNames: ReadonlyArray<string>,
): Effect.Effect<PackedTarball, BenchSetupFailed> => {
  const prefix = `${packageName.slice(1).replace('/', '-')}-`
  const pattern = packedFileNameOf(prefix)
  const found = fileNames.find((candidate) => pattern.test(candidate))
  return found === undefined
    ? Effect.fail(fail(STEP_ENTERPRISE_CLOSURE, `pnpm pack wrote no ${prefix}<version>.tgz into ${directory}`))
    : Effect.succeed({ fileName: found, tarballPath: `${directory}/${found}` })
}

const packWorkspaceClosure = (
  root: string,
  directory: string,
  turboCacheDir: string,
): Effect.Effect<ReadonlyArray<PackedTarball>, BenchSetupFailed, StepPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const cacheArg = `--cache-dir=${turboCacheDir}`
    const dryRun = yield* runChecked(
      STEP_ENTERPRISE_CLOSURE,
      [
        'pnpm',
        'exec',
        'turbo',
        'run',
        'build',
        cacheArg,
        `--filter=${CLI_BUILD_FILTER}`,
        `--filter=${TYPESCRIPT_CHECKER_BUILD_FILTER}`,
        '--dry=json',
      ],
      root,
    )
    const packages = yield* turboClosureOf(dryRun.stdout)
    yield* runChecked(
      STEP_ENTERPRISE_CLOSURE,
      ['pnpm', 'exec', 'turbo', 'run', 'build', cacheArg, ...packages.map((name) => `--filter=${name}`)],
      root,
    )
    yield* runChecked(
      STEP_ENTERPRISE_CLOSURE,
      ['pnpm', '-r', ...packages.map((name) => `--filter=${name}`), 'pack', '--pack-destination', directory],
      root,
    )
    const fileNames = yield* fs.readDirectory(directory).pipe(
      Effect.mapError((cause) => fail(STEP_ENTERPRISE_CLOSURE, `${directory} could not be listed`, cause)),
    )
    return yield* Effect.forEach(packages, (name) => packedTarballOf(directory, name, fileNames))
  })

const packedMemberOf = (pack: PackedTarball): Effect.Effect<PackedMember, BenchSetupFailed, StepPlatform> =>
  Effect.gen(function*() {
    const outcome = yield* runChecked(
      STEP_ENTERPRISE_INSTALL,
      ['tar', '-xzf', pack.tarballPath, '-O', PACKED_MANIFEST_PATH],
    )
    const manifest = yield* S.decodeEffect(S.fromJsonString(PackedManifest))(outcome.stdout).pipe(
      Effect.mapError((cause) =>
        fail(
          STEP_ENTERPRISE_INSTALL,
          `the packed tarball ${pack.fileName} carries no readable ${PACKED_MANIFEST_PATH}`,
          cause,
        )
      ),
    )
    return { tarballPath: pack.tarballPath, manifest } satisfies PackedMember
  })

const manifestPathsUnder = (
  root: string,
  step: StepSpec,
): Effect.Effect<ReadonlyArray<string>, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const relativePaths = yield* fs.readDirectory(root, { recursive: true }).pipe(
      Effect.mapError((cause) => fail(step, `${root} could not be listed`, cause)),
    )
    return relativePaths.filter((relativePath) => path.basename(relativePath) === MANIFEST_FILE_NAME)
  })

const stagedManifestsOf = (
  bundleRoot: string,
): Effect.Effect<ReadonlyArray<StagedFixtureManifest>, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifests = yield* manifestPathsUnder(bundleRoot, STEP_ENTERPRISE_INSTALL)
    return yield* Effect.forEach(manifests, (relativePath) =>
      Effect.gen(function*() {
        const bytes = yield* fs.readFile(path.join(bundleRoot, relativePath)).pipe(
          Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, `${relativePath} could not be read`, cause)),
        )
        const manifest = yield* S.decodeEffect(S.fromJsonString(FixtureManifest))(new TextDecoder().decode(bytes)).pipe(
          Effect.mapError((cause) =>
            fail(
              STEP_ENTERPRISE_INSTALL,
              `the fixture manifest ${relativePath} is not a readable ${MANIFEST_FILE_NAME}`,
              cause,
            )
          ),
        )
        return { path: relativePath, manifest } satisfies StagedFixtureManifest
      }))
  })

const rewriteManifests = (
  bundleRoot: string,
  catalogs: WorkspaceCatalogs,
): Effect.Effect<void, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifests = yield* manifestPathsUnder(bundleRoot, STEP_ENTERPRISE_MANIFESTS)
    yield* Effect.forEach(
      manifests,
      (relativePath) =>
        Effect.gen(function*() {
          const manifestPath = path.join(bundleRoot, relativePath)
          const bytes = yield* fs.readFile(manifestPath).pipe(
            Effect.mapError((cause) => fail(STEP_ENTERPRISE_MANIFESTS, `${relativePath} could not be read`, cause)),
          )
          const text = yield* Effect.fromResult(resolvedManifestText(relativePath, bytes, catalogs)).pipe(
            Effect.mapError((failure) => fail(STEP_ENTERPRISE_MANIFESTS, failure.message)),
          )
          yield* fs.writeFileString(manifestPath, text).pipe(
            Effect.mapError((cause) => fail(STEP_ENTERPRISE_MANIFESTS, `${relativePath} could not be written`, cause)),
          )
        }),
      { discard: true },
    )
  })

const enterpriseInstallSpecs = (
  workspace: ReadonlyArray<string>,
  bundleRoot: string,
  packs: ReadonlyArray<PackedTarball>,
): Effect.Effect<ReadonlyArray<string>, BenchSetupFailed, StepPlatform> =>
  Effect.gen(function*() {
    const members = yield* Effect.forEach(packs, packedMemberOf)
    const fixtures = yield* stagedManifestsOf(bundleRoot)
    const install = yield* Effect.fromResult(
      installClosure(InstallClosureCommand.make({ members, fixtures, workspace })),
    ).pipe(Effect.mapError((failure) => fail(STEP_ENTERPRISE_INSTALL, failure.message)))
    return install.specs
  })

const sideLockfilePins = (
  root: string,
  workspace: ReadonlyArray<string>,
): Effect.Effect<LockfilePins, BenchSetupFailed, StepPlatform> =>
  Effect.gen(function*() {
    const listed = yield* runChecked(
      STEP_ENTERPRISE_INSTALL,
      ['pnpm', 'ls', '-r', '--json', '--depth=Infinity'],
      root,
    )
    const listing = yield* S.decodeEffect(PnpmListingJson)(listed.stdout).pipe(
      Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, 'pnpm ls wrote no parseable dependency tree', cause)),
    )
    return Result.merge(lockfilePins(LockfilePinsCommand.make({ listing, workspaceNames: workspace })))
  })

const pinManifests = (
  bundleRoot: string,
  pins: LockfilePins,
): Effect.Effect<void, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifests = yield* manifestPathsUnder(bundleRoot, STEP_ENTERPRISE_INSTALL)
    yield* Effect.forEach(
      manifests,
      (relativePath) =>
        Effect.gen(function*() {
          const manifestPath = path.join(bundleRoot, relativePath)
          const text = yield* fs.readFileString(manifestPath).pipe(
            Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, `${relativePath} could not be read`, cause)),
          )
          const manifest = yield* S.decodeEffect(ManifestDocument)(text).pipe(
            Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, `${relativePath} is not a JSON object`, cause)),
          )
          const role = relativePath === MANIFEST_FILE_NAME ? 'root' : 'member'
          const pinned = yield* S.encodeEffect(ManifestDocument)(pinnedManifest(manifest, pins, role)).pipe(
            Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, `${relativePath} could not be encoded`, cause)),
          )
          yield* fs.writeFileString(manifestPath, pinned).pipe(
            Effect.mapError((cause) => fail(STEP_ENTERPRISE_INSTALL, `${relativePath} could not be written`, cause)),
          )
        }),
      { discard: true },
    )
  })

const NPM_INSTALL: Argv = ['npm', 'install', '--no-audit', '--no-fund', '--loglevel=warn']

const prepareEnterprise = (
  input: PrepareSideInput,
  corpus: BenchEnterpriseCorpus,
): Effect.Effect<PreparedSide, SetupFailure, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const label = sideLabel(input.side)
    const bundleRoot = path.join(input.workDir, 'enterprise')
    const packsDir = path.join(input.workDir, 'packs')

    const manifests = yield* runStep(
      label,
      STEP_ENTERPRISE_MANIFESTS,
      input.deadlineMs,
      Effect.gen(function*() {
        yield* fs.remove(bundleRoot, { recursive: true, force: true }).pipe(
          Effect.mapError((cause) => fail(STEP_ENTERPRISE_MANIFESTS, `${bundleRoot} could not be cleared`, cause)),
        )
        yield* fs.copy(input.fixtureSource, bundleRoot).pipe(
          Effect.mapError((cause) =>
            fail(STEP_ENTERPRISE_MANIFESTS, `${input.fixtureSource} could not be copied`, cause)
          ),
        )
        yield* fs.remove(path.join(bundleRoot, 'node_modules'), { recursive: true, force: true }).pipe(Effect.orDie)
        const catalogs = yield* readCatalogs(input.root)
        yield* rewriteManifests(bundleRoot, catalogs)
        yield* fs.writeFileString(path.join(bundleRoot, BENCH_CONFIG_FILE), enterpriseConfigSource(corpus)).pipe(
          Effect.mapError((cause) =>
            fail(STEP_ENTERPRISE_MANIFESTS, `${bundleRoot}/${BENCH_CONFIG_FILE} could not be written`, cause)
          ),
        )
      }),
    )

    const closure = yield* runStep(
      label,
      STEP_ENTERPRISE_CLOSURE,
      input.deadlineMs,
      Effect.gen(function*() {
        yield* fs.remove(packsDir, { recursive: true, force: true }).pipe(Effect.orDie)
        yield* fs.makeDirectory(packsDir, { recursive: true }).pipe(Effect.orDie)
        return yield* packWorkspaceClosure(input.root, packsDir, input.turboCacheDir)
      }),
    )

    const install = yield* runStep(
      label,
      STEP_ENTERPRISE_INSTALL,
      input.deadlineMs,
      Effect.gen(function*() {
        const workspace = yield* workspacePackages(input.root)
        const specs = yield* enterpriseInstallSpecs(workspace, bundleRoot, closure.value)
        yield* pinManifests(bundleRoot, yield* sideLockfilePins(input.root, workspace))
        yield* runChecked(STEP_ENTERPRISE_INSTALL, NPM_INSTALL, bundleRoot)
        yield* runChecked(STEP_ENTERPRISE_INSTALL, [...NPM_INSTALL, ...specs], bundleRoot)
      }),
    )

    return {
      side: input.side,
      root: input.root,
      cwd: bundleRoot,
      cli: path.join(bundleRoot, ...ENTERPRISE_CLI_RELATIVE),
      configFile: BENCH_CONFIG_FILE,
      setupSteps: [manifests.step, closure.step, install.step],
      recovered: setupRecoveryOf([manifests.retried, closure.retried, install.retried]),
    } satisfies PreparedSide
  })

const prepareRepo = (
  input: PrepareSideInput,
  entry: BenchRepoEntry,
): Effect.Effect<PreparedSide, SetupFailure, BenchPlatform> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const label = sideLabel(input.side)

    const repoBuild = yield* runStep(
      label,
      STEP_REPO_BUILD,
      input.deadlineMs,
      runChecked(
        STEP_REPO_BUILD,
        [
          'pnpm',
          'exec',
          'turbo',
          'run',
          'build',
          `--cache-dir=${input.turboCacheDir}`,
          ...[...ENGINE_BUILD_DIRS, entry.project].map((project) => `--filter=./${project}`),
        ],
        input.root,
      ),
    )

    const config = yield* runStep(label, STEP_CONFIGS, input.deadlineMs, writeRepoEntry(input, entry))

    return {
      side: input.side,
      root: input.root,
      cwd: config.value,
      cli: path.join(input.root, ...CLI_MAIN_RELATIVE),
      configFile: BENCH_CONFIG_FILE,
      setupSteps: [repoBuild.step, config.step],
      recovered: setupRecoveryOf([repoBuild.retried, config.retried]),
    } satisfies PreparedSide
  })

export const prepareSide = (
  input: PrepareSideInput,
): Effect.Effect<PreparedSide, SetupFailure, BenchPlatform> =>
  Match.valueTags(input.target, {
    repo: ({ entry }) => prepareRepo(input, entry),
    enterprise: ({ corpus }) => prepareEnterprise(input, corpus),
  })
