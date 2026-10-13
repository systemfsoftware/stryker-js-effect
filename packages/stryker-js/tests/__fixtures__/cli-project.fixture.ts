import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

export const BUILT_CLI = decodeURIComponent(new URL('../../dist/main.mjs', import.meta.url).pathname)

export const RELEASED_CLI = decodeURIComponent(
  new URL('../../node_modules/@systemfsoftware/stryker-js/dist/main.mjs', import.meta.url).pathname,
)

const PACKAGE_MODULES = decodeURIComponent(new URL('../../node_modules', import.meta.url).pathname)

export const REPORT_FILE = 'reports/mutation/mutation.json'

export type ProjectFiles = ReadonlyArray<readonly [string, string]>

export interface CliOutcome {
  readonly exitCode: number
  readonly output: string
}

export interface ScoredMutant {
  readonly file: string
  readonly mutator: string
  readonly replacement: string
  readonly line: number
  readonly column: number
  readonly status: string
}

const writeFilesIn = (
  root: string,
  files: ProjectFiles,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
  }).pipe(Effect.orDie)

export const writeFiles: {
  (files: ProjectFiles): (root: string) => Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>
  (root: string, files: ProjectFiles): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>
} = dual(2, writeFilesIn)

const linkModules = (root: string): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.symlink(PACKAGE_MODULES, path.join(root, 'node_modules'))
  }).pipe(Effect.orDie)

export const scratchDirectory: Effect.Effect<string, never, FileSystem.FileSystem | Scope.Scope> = Effect.gen(
  function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.realPath(yield* fs.makeTempDirectoryScoped())
  },
).pipe(Effect.orDie)

export const writeProject = (
  files: ProjectFiles,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const root = yield* scratchDirectory
    yield* writeFiles(root, files)
    yield* linkModules(root)
    return root
  })

const copyTree = (
  from: string,
  to: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(to, { recursive: true })
    const entries = yield* fs.readDirectory(from)
    yield* Effect.forEach(
      entries.filter((entry) => entry !== 'node_modules'),
      (entry) =>
        Effect.gen(function*() {
          const source = path.join(from, entry)
          const info = yield* fs.stat(source)
          yield* info.type === 'Directory'
            ? copyTree(source, path.join(to, entry))
            : fs.copyFile(source, path.join(to, entry))
        }),
      { discard: true },
    )
  }).pipe(Effect.orDie)

export const copyProject = (
  from: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const to = yield* scratchDirectory
    yield* copyTree(from, to)
    yield* linkModules(to)
    return to
  })

const CLI_ENV = { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' }

const startCli = (cli: string, root: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.spawn(
      ChildProcess.make(globalThis.process.execPath, [cli, ...args], {
        cwd: root,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: CLI_ENV,
        extendEnv: true,
      }),
    ))

export interface CliRun {
  readonly root: string
  readonly args: ReadonlyArray<string>
  readonly cli?: string
}

export const runCli = ({ root, args, cli = BUILT_CLI }: CliRun): Effect.Effect<
  CliOutcome,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* startCli(cli, root, args)
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const stderr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      return {
        exitCode: Number(exitCode),
        output: `${yield* Fiber.join(stdout)}\n${yield* Fiber.join(stderr)}`,
      }
    }),
  ).pipe(Effect.orDie)

const decodeEvent = S.decodeOption(S.fromJsonString(RunEvent.RunEvent))

const isMutantEvent = (line: string): boolean => Option.exists(decodeEvent(line), S.is(RunEvent.RunMutantTested))

export const runCliKilledAtFirstMutant = ({ root, args }: Omit<CliRun, 'cli'>): Effect.Effect<
  boolean,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* startCli(BUILT_CLI, root, args)
      yield* Effect.forkScoped(handle.stderr.pipe(Stream.runDrain))
      const sawMutant = yield* handle.stdout.pipe(
        Stream.decodeText,
        Stream.splitLines,
        Stream.filter(isMutantEvent),
        Stream.runHead,
        Effect.map(Option.isSome),
      )
      yield* Effect.when(handle.kill({ killSignal: 'SIGKILL' }), Effect.succeed(sawMutant))
      yield* Effect.ignore(handle.exitCode)
      return sawMutant
    }),
  ).pipe(Effect.orDie)

const decodeReport = S.decodeUnknownOption(S.fromJsonString(Report.MutationTestResult))

export const scoredMutantsOf = (
  root: string,
): Effect.Effect<readonly ScoredMutant[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, REPORT_FILE)).pipe(Effect.orElseSucceed(() => ''))
    return Option.match(decodeReport(text), {
      onNone: (): readonly ScoredMutant[] => [],
      onSome: (report) =>
        Object.entries(report.files)
          .flatMap(([file, result]) =>
            result.mutants.map((mutant): ScoredMutant => ({
              file: path.isAbsolute(file) ? path.relative(root, file) : file,
              mutator: mutant.mutatorName,
              replacement: mutant.replacement ?? '',
              line: mutant.location.start.line,
              column: mutant.location.start.column,
              status: mutant.status,
            }))
          )
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    })
  })

export const lineCountOf = (file: string): Effect.Effect<number, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(file).pipe(
      Effect.map((text) => text.split('\n').filter((line) => line.length > 0).length),
      Effect.orElseSucceed(() => 0),
    ))

export const INCREMENTAL_FILE = 'reports/main.json'

export interface Hold {
  readonly release: string
  readonly afterExecutions: number
}

export interface JsProjectShape {
  readonly log: string
  readonly hold?: Hold
  readonly configExtras?: string
}

const jsConfigOf = (extras: string): string =>
  `export default {
  testRunner: 'vm',
  plugins: [],
  reporters: ['json'],
  jsonReporter: { fileName: '${REPORT_FILE}' },
  checkers: [],
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  thresholds: { high: 80, low: 60, break: null },
  incremental: true,
  incrementalFile: '${INCREMENTAL_FILE}',
${extras}}
`

const holdUntilReleased = (log: string, hold: Hold | undefined): readonly string[] =>
  hold === undefined ? [] : [
    `  const executions = readFileSync(${JSON.stringify(log)}, 'utf8').split('\\n').filter(Boolean).length`,
    `  if (executions > ${hold.afterExecutions}) {`,
    `    while (!existsSync(${
      JSON.stringify(hold.release)
    })) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)`,
    '  }',
  ]

export const jsProjectFiles = ({ log, hold, configExtras = '' }: JsProjectShape): ProjectFiles => [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['stryker.config.mjs', jsConfigOf(configExtras)],
  [
    'src/math.js',
    ['function add(left, right) {', '  return left + right;', '}', '', 'module.exports = { add };', '']
      .join('\n'),
  ],
  [
    'src/other.js',
    ['function label() {', "  return 'left' + 'right';", '}', '', 'module.exports = { label };', '']
      .join('\n'),
  ],
  [
    'test/killing.test.mjs',
    [
      "import { appendFileSync, existsSync, readFileSync } from 'node:fs'",
      "import { expect, test } from 'vitest'",
      "import math from '../src/math.js'",
      '',
      "test('adds two numbers', () => {",
      `  appendFileSync(${JSON.stringify(log)}, 'adds two numbers\\n')`,
      ...holdUntilReleased(log, hold),
      '  expect(math.add(1, 2)).toBe(3)',
      '})',
      '',
    ].join('\n'),
  ],
]

export const logFile: Effect.Effect<string, never, FileSystem.FileSystem | Scope.Scope> = Effect.map(
  scratchDirectory,
  (directory) => `${directory}/executions.log`,
)

export interface CountedRun extends CliOutcome {
  readonly scored: readonly ScoredMutant[]
  readonly executions: number
}

export interface CountedCliRun extends CliRun {
  readonly log: string
}

export const runCounted = ({ log, ...run }: CountedCliRun): Effect.Effect<
  CountedRun,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const before = yield* lineCountOf(log)
    const outcome = yield* runCli(run)
    const scored = yield* scoredMutantsOf(run.root)
    return { ...outcome, scored, executions: (yield* lineCountOf(log)) - before }
  })

export const exitOf = (run: CliOutcome): number | string =>
  run.exitCode === 0 ? 0 : `exit ${run.exitCode}\n${run.output.slice(-4000)}`

export const statusesOf = (scored: ReadonlyArray<ScoredMutant>): readonly string[] =>
  [...new Set(scored.map((mutant) => mutant.status))].sort()
