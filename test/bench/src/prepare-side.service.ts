import { Array as Arr, Boolean, Duration, Effect, FileSystem, Match, Option, Path, Schema as S, Stream } from 'effect'
import type { BadArgument, PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
  type BenchEnterpriseCorpus,
  type BenchRepoEntry,
  type BenchSide,
  FixtureManifest,
  installClosure,
  InstallClosureCommand,
  PackedManifest,
  type PackedMember,
  parseWorkspaceCatalogs,
  resolvedManifestText,
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
}

type SetupCause = PlatformError | BadArgument | S.SchemaError

type BenchPlatform = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

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

interface Timed<A> {
  readonly value: A
  readonly step: SetupStep
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

const STEP_REPO_BUILD = 'turbo build the repo corpus projects'
const STEP_CONFIGS = 'write the per-entry bench configs'
const STEP_ENTERPRISE_MANIFESTS = 'resolve the enterprise fixture catalogs'
const STEP_ENTERPRISE_CLOSURE = 'build and pack the enterprise closure'
const STEP_ENTERPRISE_INSTALL = 'install the enterprise fixture'

const PACKED_VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

const packedFileNameOf = (prefix: string): RegExp =>
  new RegExp(`^${prefix.replace(REGEXP_SPECIAL, String.raw`\$&`)}(${PACKED_VERSION})\\.tgz$`)

const fail = (step: string, detail: string, cause?: SetupCause): BenchSetupFailed =>
  cause === undefined ? BenchSetupFailed.make({ step, detail }) : BenchSetupFailed.make({ step, detail, cause })

const sideLabel = (side: BenchSide): string => `side ${side}`

const runCommand = (argv: Argv, cwd?: string): Effect.Effect<CommandOutcome, BenchSetupFailed, BenchPlatform> =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const [command, ...args] = argv
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, cwd === undefined ? {} : { cwd })).pipe(
      Effect.mapError((cause) => fail(`spawn ${command}`, 'the command could not be started', cause)),
    )
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        Stream.runCollect(Stream.decodeText(handle.stdout)),
        Stream.runCollect(Stream.decodeText(handle.stderr)),
        handle.exitCode,
      ] as const,
      { concurrency: 'unbounded' },
    ).pipe(Effect.mapError((cause) => fail(`read ${command} output`, 'the command output could not be read', cause)))
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
  }))

const runChecked = (
  step: string,
  argv: Argv,
  cwd?: string,
): Effect.Effect<CommandOutcome, BenchSetupFailed, BenchPlatform> =>
  Effect.filterOrFail(
    runCommand(argv, cwd),
    (outcome) => outcome.exitCode === 0,
    (outcome) =>
      fail(step, `exited ${outcome.exitCode}\n${`${outcome.stdout}${outcome.stderr}`.slice(-STDERR_TAIL_CHARS)}`),
  )

const timed = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Timed<A>, E, R> =>
  Effect.map(Effect.timed(effect), ([elapsed, value]) => ({ step: { name, ms: Duration.toMillis(elapsed) }, value }))

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
): Effect.Effect<ReadonlyArray<string>, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const listing = yield* runChecked(
      STEP_ENTERPRISE_CLOSURE,
      ['pnpm', 'ls', '-r', '--depth', '-1', '--json'],
      root,
    )
    const projects = yield* S.decodeEffect(S.fromJsonString(S.Array(WorkspaceListing)))(listing.stdout).pipe(
      Effect.mapError((cause) => fail(STEP_ENTERPRISE_CLOSURE, 'pnpm ls wrote no parseable workspace listing', cause)),
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
): Effect.Effect<ReadonlyArray<PackedTarball>, BenchSetupFailed, BenchPlatform> =>
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

const packedMemberOf = (pack: PackedTarball): Effect.Effect<PackedMember, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const outcome = yield* runChecked(
      STEP_ENTERPRISE_CLOSURE,
      ['tar', '-xzf', pack.tarballPath, '-O', PACKED_MANIFEST_PATH],
    )
    const manifest = yield* S.decodeEffect(S.fromJsonString(PackedManifest))(outcome.stdout).pipe(
      Effect.mapError((cause) =>
        fail(
          STEP_ENTERPRISE_CLOSURE,
          `the packed tarball ${pack.fileName} carries no readable ${PACKED_MANIFEST_PATH}`,
          cause,
        )
      ),
    )
    return { tarballPath: pack.tarballPath, manifest } satisfies PackedMember
  })

const manifestPathsUnder = (
  root: string,
  step: string,
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
    const manifests = yield* manifestPathsUnder(bundleRoot, STEP_ENTERPRISE_CLOSURE)
    return yield* Effect.forEach(manifests, (relativePath) =>
      Effect.gen(function*() {
        const bytes = yield* fs.readFile(path.join(bundleRoot, relativePath)).pipe(
          Effect.mapError((cause) => fail(STEP_ENTERPRISE_CLOSURE, `${relativePath} could not be read`, cause)),
        )
        const manifest = yield* S.decodeEffect(S.fromJsonString(FixtureManifest))(new TextDecoder().decode(bytes)).pipe(
          Effect.mapError((cause) =>
            fail(
              STEP_ENTERPRISE_CLOSURE,
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
  root: string,
  bundleRoot: string,
  packs: ReadonlyArray<PackedTarball>,
): Effect.Effect<ReadonlyArray<string>, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const workspace = yield* workspacePackages(root)
    const members = yield* Effect.forEach(packs, packedMemberOf)
    const fixtures = yield* stagedManifestsOf(bundleRoot)
    const install = yield* Effect.fromResult(
      installClosure(InstallClosureCommand.make({ members, fixtures, workspace })),
    ).pipe(Effect.mapError((failure) => fail(STEP_ENTERPRISE_CLOSURE, failure.message)))
    return install.specs
  })

const prepareEnterprise = (
  input: PrepareSideInput,
  corpus: BenchEnterpriseCorpus,
): Effect.Effect<PreparedSide, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const label = sideLabel(input.side)
    const bundleRoot = path.join(input.workDir, 'enterprise')
    const packsDir = path.join(input.workDir, 'packs')

    const manifests = yield* timed(
      `${label} ${STEP_ENTERPRISE_MANIFESTS}`,
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

    const closure = yield* timed(
      `${label} ${STEP_ENTERPRISE_CLOSURE}`,
      Effect.gen(function*() {
        yield* fs.remove(packsDir, { recursive: true, force: true }).pipe(Effect.orDie)
        yield* fs.makeDirectory(packsDir, { recursive: true }).pipe(Effect.orDie)
        return yield* packWorkspaceClosure(input.root, packsDir, input.turboCacheDir)
      }),
    )

    const install = yield* timed(
      `${label} ${STEP_ENTERPRISE_INSTALL}`,
      Effect.gen(function*() {
        const specs = yield* enterpriseInstallSpecs(input.root, bundleRoot, closure.value)
        yield* runChecked(
          STEP_ENTERPRISE_INSTALL,
          ['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'],
          bundleRoot,
        )
        yield* runChecked(
          STEP_ENTERPRISE_INSTALL,
          ['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error', ...specs],
          bundleRoot,
        )
      }),
    )

    return {
      side: input.side,
      root: input.root,
      cwd: bundleRoot,
      cli: path.join(bundleRoot, ...ENTERPRISE_CLI_RELATIVE),
      configFile: BENCH_CONFIG_FILE,
      setupSteps: [manifests.step, closure.step, install.step],
    } satisfies PreparedSide
  })

const prepareRepo = (
  input: PrepareSideInput,
  entry: BenchRepoEntry,
): Effect.Effect<PreparedSide, BenchSetupFailed, BenchPlatform> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const label = sideLabel(input.side)

    const repoBuild = yield* timed(
      `${label} ${STEP_REPO_BUILD}`,
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

    const config = yield* timed(`${label} ${STEP_CONFIGS}`, writeRepoEntry(input, entry))

    return {
      side: input.side,
      root: input.root,
      cwd: config.value,
      cli: path.join(input.root, ...CLI_MAIN_RELATIVE),
      configFile: BENCH_CONFIG_FILE,
      setupSteps: [repoBuild.step, config.step],
    } satisfies PreparedSide
  })

export const prepareSide = (
  input: PrepareSideInput,
): Effect.Effect<PreparedSide, BenchSetupFailed, BenchPlatform> =>
  Match.valueTags(input.target, {
    repo: ({ entry }) => prepareRepo(input, entry),
    enterprise: ({ corpus }) => prepareEnterprise(input, corpus),
  })
