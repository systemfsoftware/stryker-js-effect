import { Differential } from '@systemfsoftware/differential-spec'
import { Configuration, Engine, Plugin, Worker } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins as vmRunnerPlugins } from '@systemfsoftware/stryker-js-vm-runner'
import * as TestTelemetry from '@systemfsoftware/vitest-config/telemetry'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import * as fc from 'fast-check'
import { createVitest } from 'vitest/node'
import type { RunnerTask, RunnerTestCase, RunnerTestFile, Vitest } from 'vitest/node'

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const FIXTURES_DIR_SEGMENTS: readonly [string, string] = ['testResources', 'vm-parity']

const INTERRUPT_AFTER_MS = 280_000

/**
 * Wall-clock bound for one reference mutant run, and the grace the spawner waits after
 * SIGKILL. The `hangs` fixture's mutated loops spin synchronously, so nothing inside the
 * run can interrupt them; the bound and the process-group kill read those runs as Timeout
 * without hanging the suite.
 */
const MUTANT_RUN_BOUND_MS = 5_000
const MUTANT_KILL_GRACE = Duration.seconds(1)
const BASELINE_RUN_BOUND_MS = 60_000

interface Location {
  readonly line: number
  readonly column: number
}

interface MutantRecord {
  readonly file: string
  readonly start: Location
  readonly end: Location
  readonly mutatorName: string
  readonly replacement: string
  readonly status: string
  readonly statusReason?: string | undefined
}

interface Fixture {
  readonly name: string
  readonly subroots: readonly string[]
  readonly mutants: boolean
}

const FIXTURES: readonly Fixture[] = [
  { name: 'mocking', subroots: ['.'], mutants: true },
  { name: 'snapshots', subroots: ['.'], mutants: true },
  { name: 'hangs', subroots: ['.'], mutants: true },
  { name: 'config', subroots: ['.'], mutants: true },
  { name: 'runner-api', subroots: ['.'], mutants: true },
  { name: 'environments', subroots: ['.', 'node'], mutants: false },
  { name: 'transforms', subroots: ['.'], mutants: false },
  { name: 'projects', subroots: ['.'], mutants: false },
]

type Outcomes = Readonly<Record<string, string>>

const recordOf = (entries: readonly (readonly [string, string])[]): Outcomes =>
  Object.fromEntries([...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))

/**
 * The vm runner drives its own worker and an engine run changes the whole process's working
 * directory, so on top of the differential's dual execution every external run — real vitest,
 * the engine, a vm dry run — takes this permit instead of interleaving with another.
 */
const exclusiveRuns = Semaphore.makeUnsafe(1)

const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Semaphore.withPermits(exclusiveRuns, 1)(effect)

const dieOnFailure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
  Effect.catchCause(effect, (cause) => Effect.die(new Error(Cause.pretty(cause))))

const labelled = <A>(label: string) => (effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.catchCause(effect, (cause) => Effect.die(new Error(`${label}: ${Cause.pretty(cause)}`)))

const prepareSandboxFrom = (
  source: string,
  prefix: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: `vm-parity-${prefix}-` }))
    yield* fs.copy(source, root, { overwrite: true })
    yield* fs.remove(path.join(root, 'node_modules'), { recursive: true, force: true })
    yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
    return root
  }).pipe(Effect.orDie)

const fixtureSource = (fixture: string): Effect.Effect<string, never, Path.Path> =>
  Effect.map(Path.Path, (path) => path.join(PACKAGE_ROOT, ...FIXTURES_DIR_SEGMENTS, fixture))

const removeSandbox = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })).pipe(Effect.orDie)

const withSandboxFrom = <A, E, R>(
  source: string,
  prefix: string,
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(prepareSandboxFrom(source, prefix), use, (root) => removeSandbox(root))

const withSandbox = <A, E, R>(
  fixture: string,
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(fixtureSource(fixture), (source) => withSandboxFrom(source, fixture, use))

const prepareGeneratedSandbox = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'vm-parity-generated-' }))
    yield* fs.writeFileString(
      path.join(root, 'package.json'),
      '{\n  "name": "vm-parity-generated",\n  "private": true,\n  "type": "module"\n}\n',
    )
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
    return root
  }).pipe(Effect.orDie)

const statusOf = (task: RunnerTestCase): TestRunner.TestStatus => {
  if (task.mode === 'skip' || task.mode === 'todo' || task.result?.state === 'skip') {
    return 'skipped'
  }
  if (task.result?.state === 'fail') {
    return 'failed'
  }
  return task.result?.state === 'pass' ? 'success' : 'skipped'
}

const captureFile = (
  file: RunnerTestFile,
  path: Path.Path,
  directory: string,
): readonly (readonly [string, string])[] => {
  const captured: Array<readonly [string, string]> = []
  const visit = (task: RunnerTask, ancestors: readonly string[]): void => {
    if (task.type === 'suite') {
      const nested = [...ancestors, task.name]
      for (const child of task.tasks) {
        visit(child, nested)
      }
      return
    }
    captured.push([
      `${path.relative(directory, file.filepath)}#${[...ancestors, task.name].join(' > ')}`,
      statusOf(task),
    ])
  }
  for (const task of file.tasks) {
    visit(task, [])
  }
  return captured
}

const collectVitest = (
  vitest: Vitest,
  path: Path.Path,
  directory: string,
): readonly (readonly [string, string])[] =>
  vitest.state.getFiles().flatMap((file) => captureFile(file, path, directory))

const runRealVitest = (
  directory: string,
): Effect.Effect<readonly (readonly [string, string])[], never, Path.Path> =>
  Effect.scoped(
    Effect.gen(function*() {
      const path = yield* Path.Path
      const vitest = yield* Effect.acquireRelease(
        Effect.promise(() => createVitest({ root: directory, watch: false })),
        (instance) => Effect.promise(() => instance.close().then(() => undefined, () => undefined)),
      )
      yield* Effect.promise(() => vitest.start())
      return collectVitest(vitest, path, directory)
    }),
  ).pipe(dieOnFailure, serialized)

const realTestOutcomes = (
  root: string,
  subroots: readonly string[],
): Effect.Effect<Outcomes, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const rows: Array<readonly [string, string]> = []
    for (const subroot of subroots) {
      const directory = subroot === '.' ? root : path.join(root, subroot)
      const captured = yield* runRealVitest(directory)
      for (const [key, status] of captured) {
        rows.push([subroot === '.' ? key : `${subroot}/${key}`, status])
      }
    }
    return recordOf(rows)
  })

const contextFor = (defaults: Options.StrykerOptions, directory: string): Plugin.TestRunnerBuildContext => ({
  options: { ...defaults, testRunner: 'vm', disableBail: true },
  fileDescriptions: {},
  sandboxWorkingDirectory: directory,
  idGenerator: { next: Effect.succeed(1) },
  retire: Effect.void,
  testFiles: [],
})

const vmChildRunner = (
  context: Plugin.TestRunnerBuildContext,
): Effect.Effect<Plugin.PooledTestRunner, Plugin.PooledTestRunnerError, Scope.Scope | Worker.WorkerLauncher> =>
  Effect.flatMap(
    Effect.orDie(Effect.fromOption(Arr.head(vmRunnerPlugins))),
    (runner) =>
      Plugin.makeChildProcessTestRunner({
        options: context.options,
        fileDescriptions: context.fileDescriptions,
        sandboxWorkingDirectory: context.sandboxWorkingDirectory,
        workerEntrypoint: runner.workerEntry,
        idGenerator: context.idGenerator,
      }),
  )

const withVmRunner = <A, R>(
  directory: string,
  use: (runner: Plugin.PooledTestRunner) => Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R> =>
  Effect.gen(function*() {
    const defaults = yield* Configuration.createDefaultOptions
    const context = contextFor(defaults, directory)
    return yield* Effect.flatMap(Plugin.buildTestRunner(context, vmChildRunner(context)), use)
  }).pipe(
    Effect.provide(Engine.nodePlatformLayer),
    Effect.scoped,
    Effect.orDie,
  )

const describeDryRunFailure = (dry: Exclude<TestRunner.DryRunResult, { readonly status: 'complete' }>): string =>
  dry.status === 'error' ? `the vm dry run failed: ${dry.errorMessage}` : `the vm dry run ended in ${dry.status}`

const vmTestOutcomes = (
  root: string,
  subroots: readonly string[],
  path: Path.Path,
): Effect.Effect<Outcomes> =>
  Effect.forEach(
    subroots,
    (subroot) =>
      serialized(
        withVmRunner(subroot === '.' ? root : path.join(root, subroot), (runner) =>
          Effect.gen(function*() {
            const dry = yield* runner.dryRun({ timeout: 180_000, coverageAnalysis: 'off', disableBail: true }).pipe(
              Effect.orDie,
            )
            if (dry.status !== 'complete') {
              return yield* Effect.die(new Error(describeDryRunFailure(dry)))
            }
            return dry.tests.map((test): readonly [string, string] => {
              const hash = test.id.lastIndexOf('#')
              const file = hash === -1 ? '' : test.id.slice(0, hash)
              return [subroot === '.' ? `${file}#${test.name}` : `${subroot}/${file}#${test.name}`, test.status]
            })
          })),
      ),
    { concurrency: 1 },
  ).pipe(Effect.map((rows) => recordOf(rows.flat())))

const sameOutcomes = (reference: Outcomes, candidate: Outcomes): boolean => {
  const keys = Object.keys(reference)
  if (keys.length === 0) {
    return false
  }
  if (keys.length !== Object.keys(candidate).length) {
    return false
  }
  return keys.every((key) => reference[key] === candidate[key])
}

const MUTATION_RUN_OPTIONS = {
  testRunner: 'vm',
  mutate: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/*.spec.ts',
    '!src/__mocks__/**',
  ],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  ignorePatterns: ['**/node_modules/**'],
  reporters: ['json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
} as const

const mutationEngineEffect = (root: string): Effect.Effect<readonly MutantRecord[], never> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const done = yield* Engine.strykerCell(MUTATION_RUN_OPTIONS)
        return done.results.map((result): MutantRecord => ({
          file: path.relative(root, result.fileName),
          start: { line: result.location.start.line, column: result.location.start.column },
          end: { line: result.location.end.line, column: result.location.end.column },
          mutatorName: result.mutatorName,
          replacement: result.replacement,
          status: result.status,
          statusReason: result.status === 'Killed' ? result.statusReason : undefined,
        }))
      }),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  ).pipe(Effect.provide(Engine.nodePlatformLayer), dieOnFailure)

const engineReportOf = (fixture: Fixture): Effect.Effect<readonly MutantRecord[]> =>
  withSandbox(
    fixture.name,
    (root) => serialized(Effect.andThen(recordUnmutatedSnapshots(fixture, root), mutationEngineEffect(root))),
  )
    .pipe(
      Effect.provide(Engine.nodePlatformLayer),
      dieOnFailure,
    )

const engineReports = new Map<string, Effect.Effect<readonly MutantRecord[]>>()

const mutantReportOf = (fixture: Fixture): Effect.Effect<readonly MutantRecord[]> =>
  Effect.suspend(() => {
    const report = engineReports.get(fixture.name) ?? engineReportOf(fixture).pipe(Effect.cached, Effect.runSync)
    engineReports.set(fixture.name, report)
    return report
  })

const offsetOf = (lines: readonly string[], line: number, column: number): number => {
  let offset = 0
  for (let index = 0; index < line - 1; index++) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset + (column - 1)
}

const applyMutant = (
  root: string,
  mutant: MutantRecord,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(root, mutant.file)
    const source = yield* fs.readFileString(target)
    const lines = source.split('\n')
    const start = offsetOf(lines, mutant.start.line, mutant.start.column)
    const end = offsetOf(lines, mutant.end.line, mutant.end.column)
    yield* fs.writeFileString(target, source.slice(0, start) + mutant.replacement + source.slice(end))
  }).pipe(Effect.orDie)

const OUTPUT_TAIL_CHARS = 4_000

const verdictOf = (outcome: Option.Option<ChildProcessSpawner.ExitCode>): string =>
  Option.match(outcome, {
    onNone: () => 'Timeout',
    onSome: (code) => (code === 0 ? 'Survived' : 'Killed'),
  })

const nodeModulesLinkOf = (root: string): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const nodeModules = path.join(root, 'node_modules')
    return yield* fs.readLink(nodeModules).pipe(
      Effect.catch(() => fs.stat(nodeModules).pipe(Effect.map((info) => `not a link: ${info.type}`))),
      Effect.orElseSucceed(() => 'missing'),
    )
  })

const runBoundedVitestProcess = (
  root: string,
  boundMs: number,
  args: ReadonlyArray<string>,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*() {
      const path = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      yield* Effect.annotateCurrentSpan({ 'vm_parity.host_cwd': path.resolve('.') })
      const handle = yield* spawner.spawn(
        ChildProcess.make(path.join(root, 'node_modules', '.bin', 'vitest'), [...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          forceKillAfter: MUTANT_KILL_GRACE,
        }),
      )
      const output = yield* Effect.forkScoped(handle.all.pipe(Stream.decodeText, Stream.mkString))
      const outcome = yield* Effect.timeoutOption(handle.exitCode, boundMs)
      const verdict = verdictOf(outcome)
      yield* Effect.annotateCurrentSpan({
        'vm_parity.verdict': verdict,
        'process.exit_code': Option.match(outcome, { onNone: () => -1, onSome: Number }),
      })
      yield* Effect.when(
        Effect.all([Fiber.join(output), nodeModulesLinkOf(root)]).pipe(
          Effect.flatMap(([text, nodeModulesLink]) =>
            Effect.logWarning('vm_parity.vitest_process.failed').pipe(
              Effect.annotateLogs({
                'vm_parity.root': root,
                'vm_parity.host_cwd': path.resolve('.'),
                'vm_parity.node_modules_link': nodeModulesLink,
                'vm_parity.output_tail': text.slice(-OUTPUT_TAIL_CHARS),
              }),
            )
          ),
        ),
        Effect.succeed(verdict === 'Killed'),
      )
      return verdict
    }),
  ).pipe(
    Effect.withSpan('vm_parity.vitest_process', {
      attributes: { 'vm_parity.root': root, 'vm_parity.args': args.join(' '), 'vm_parity.bound_ms': boundMs },
    }),
    dieOnFailure,
  )

const recordUnmutatedSnapshots = (
  fixture: Fixture,
  root: string,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(
    runBoundedVitestProcess(root, BASELINE_RUN_BOUND_MS, ['run', '--update']),
    (baseline) =>
      baseline === 'Survived'
        ? Effect.void
        : Effect.die(new Error(`the unmutated ${fixture.name} baseline did not pass: ${baseline}`)),
  )

const realVerdictForMutant = (
  fixture: Fixture,
  baselined: string,
  mutant: MutantRecord,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner> =>
  withSandboxFrom(baselined, fixture.name, (root) =>
    serialized(
      Effect.gen(function*() {
        yield* applyMutant(root, mutant)
        return yield* runBoundedVitestProcess(root, MUTANT_RUN_BOUND_MS, ['run', '--bail=1'])
      }),
    ))

const mutantKey = (mutant: MutantRecord): string =>
  `${mutant.file}:${mutant.start.line}:${mutant.start.column}:${mutant.mutatorName}:${mutant.replacement}`

const mutationEngineVerdicts = (fixture: Fixture): Effect.Effect<Outcomes> =>
  Effect.gen(function*() {
    const mutants = yield* mutantReportOf(fixture)
    return recordOf(mutants.map((mutant): readonly [string, string] => [mutantKey(mutant), candidateVerdictOf(mutant)]))
  }).pipe(labelled('the vm mutation engine run failed'))

const realMutantVerdicts = (fixture: Fixture): Effect.Effect<Outcomes> =>
  Effect.gen(function*() {
    const mutants = yield* mutantReportOf(fixture)
    const rows: Array<readonly [string, string]> = []
    yield* withSandbox(fixture.name, (baselined) =>
      Effect.gen(function*() {
        yield* serialized(recordUnmutatedSnapshots(fixture, baselined))
        for (const mutant of mutants) {
          rows.push([mutantKey(mutant), yield* realVerdictForMutant(fixture, baselined, mutant)])
        }
      }))
    return recordOf(rows)
  }).pipe(
    Effect.provide(Engine.nodePlatformLayer),
    dieOnFailure,
    labelled('the real-vitest mutant reference failed'),
  )

const RUNAWAY_VERDICT = 'Killed/runaway'
const RUNAWAY_REASON_PREFIX = TestRunner.HitLimitReasonPrefix.literal

const candidateVerdictOf = (mutant: MutantRecord): string =>
  mutant.status === 'Killed' && (mutant.statusReason?.startsWith(RUNAWAY_REASON_PREFIX) ?? false)
    ? RUNAWAY_VERDICT
    : mutant.status

const asComparableVmVerdict = (status: string): string =>
  status === 'NoCoverage' ? 'Survived' : status === RUNAWAY_VERDICT ? 'Killed' : status

const isRunawayVerdict = (referenceVerdict: string, candidateVerdict: string): boolean =>
  referenceVerdict === 'Timeout' && candidateVerdict === RUNAWAY_VERDICT

const verdictsAgree = (reference: Outcomes, candidate: Outcomes): boolean => {
  const keys = Object.keys(reference)
  if (keys.length === 0) {
    return false
  }
  if (keys.length !== Object.keys(candidate).length) {
    return false
  }
  return keys.every((key) => {
    const referenceVerdict = reference[key]
    const candidateVerdict = candidate[key]
    if (referenceVerdict === undefined || candidateVerdict === undefined) {
      return false
    }
    return referenceVerdict === asComparableVmVerdict(candidateVerdict) ||
      isRunawayVerdict(referenceVerdict, candidateVerdict)
  })
}

interface GeneratedCase {
  readonly modifier: 'plain' | 'fails' | 'skip' | 'todo' | 'only' | 'eachNumbers' | 'eachStrings'
  readonly body: 'pass' | 'fail'
}

interface GeneratedSuite {
  readonly cases: readonly GeneratedCase[]
  readonly nested: readonly GeneratedSuite[]
  readonly beforeEach: boolean
  readonly afterEach: boolean
}

const generatedCase: fc.Arbitrary<GeneratedCase> = fc.record({
  modifier: fc.constantFrom('plain', 'fails', 'skip', 'todo', 'only', 'eachNumbers', 'eachStrings'),
  body: fc.constantFrom('pass', 'fail'),
})

const generatedSuiteAtDepth = (depth: number): fc.Arbitrary<GeneratedSuite> =>
  fc.record({
    cases: fc.array(generatedCase, { maxLength: 3 }),
    nested: depth === 0
      ? fc.constant<readonly GeneratedSuite[]>([])
      : fc.array(generatedSuiteAtDepth(depth - 1), { maxLength: 2 }),
    beforeEach: fc.boolean(),
    afterEach: fc.boolean(),
  })

const declaresTest = (suite: GeneratedSuite): boolean => suite.cases.length > 0 || suite.nested.some(declaresTest)

const generatedSuites: fc.Arbitrary<GeneratedSuite> = generatedSuiteAtDepth(2).filter(declaresTest)

const passBody = 'expect(true).toBe(true)'
const failBody = 'expect(true).toBe(false)'

const eachBody = (body: GeneratedCase['body']): string =>
  body === 'pass' ? 'expect(value).toBe(value)' : 'expect(value).not.toBe(value)'

const renderCase = (item: GeneratedCase, path: readonly number[]): string => {
  const name = `case ${path.join('.')}`
  const plain = item.body === 'pass' ? passBody : failBody
  switch (item.modifier) {
    case 'plain':
      return `test(${JSON.stringify(name)}, () => { ${plain} })`
    case 'fails':
      return `test.fails(${JSON.stringify(name)}, () => { ${plain} })`
    case 'skip':
      return `test.skip(${JSON.stringify(name)}, () => { ${plain} })`
    case 'todo':
      return `test.todo(${JSON.stringify(name)})`
    case 'only':
      return `test.only(${JSON.stringify(name)}, () => { ${plain} })`
    case 'eachNumbers':
      return `test.each([1, 2])(\`${name} %i\`, (value) => { ${eachBody(item.body)} })`
    case 'eachStrings':
      return `test.each(['alpha', 'beta'])(\`${name} %s\`, (value) => { ${eachBody(item.body)} })`
  }
}

const renderSuite = (suite: GeneratedSuite, path: readonly number[]): readonly string[] => {
  const lines: string[] = []
  const opening = path.length === 0 ? undefined : `describe(${JSON.stringify(`suite ${path.join('.')}`)}, () => {`
  if (opening !== undefined) {
    lines.push(opening)
  }
  if (suite.beforeEach) {
    lines.push('beforeEach(() => { hookRuns.push(1) })')
  }
  if (suite.afterEach) {
    lines.push('afterEach(() => { hookRuns.push(-1) })')
  }
  suite.cases.forEach((item, index) => {
    lines.push(renderCase(item, [...path, index]))
  })
  suite.nested.forEach((child, index) => {
    lines.push(...renderSuite(child, [...path, index]))
  })
  if (opening !== undefined) {
    lines.push('})')
  }
  return lines
}

const renderGeneratedSuite = (suite: GeneratedSuite): string =>
  [
    "import { afterEach, beforeEach, describe, expect, test } from 'vitest'",
    '',
    'const hookRuns: Array<number> = []',
    'beforeEach(() => { hookRuns.push(1) })',
    'afterEach(() => { hookRuns.pop() })',
    '',
    ...renderSuite(suite, []),
    '',
  ].join('\n')

const withGeneratedSuite = <A>(
  suite: GeneratedSuite,
  use: (directory: string, path: Path.Path) => Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const root = yield* prepareGeneratedSandbox()
    return yield* Effect.acquireUseRelease(
      Effect.succeed(root),
      (directory) =>
        Effect.gen(function*() {
          const path = yield* Path.Path
          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(path.join(directory, 'src', 'generated.test.ts'), renderGeneratedSuite(suite))
          return yield* use(directory, path)
        }).pipe(Effect.orDie),
      (directory) => removeSandbox(directory),
    )
  })

const generatedRealOutcomes = (suite: GeneratedSuite): Effect.Effect<Outcomes> =>
  withGeneratedSuite(suite, (directory) => realTestOutcomes(directory, ['.'])).pipe(
    Effect.provide(Engine.nodePlatformLayer),
    dieOnFailure,
    labelled('the real-vitest reference failed'),
  )

const generatedVmOutcomes = (suite: GeneratedSuite): Effect.Effect<Outcomes> =>
  withGeneratedSuite(suite, (directory, path) => vmTestOutcomes(directory, ['.'], path)).pipe(
    Effect.provide(Engine.nodePlatformLayer),
    dieOnFailure,
    labelled('the vm runner failed'),
  )

const realFixtureOutcomes = (fixture: Fixture): Effect.Effect<Outcomes> =>
  withSandbox(fixture.name, (root) => realTestOutcomes(root, fixture.subroots)).pipe(
    Effect.provide(Engine.nodePlatformLayer),
    dieOnFailure,
    labelled('the real-vitest reference failed'),
  )

const vmFixtureOutcomes = (fixture: Fixture): Effect.Effect<Outcomes> =>
  withSandbox(fixture.name, (root) =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      return yield* vmTestOutcomes(root, fixture.subroots, path)
    })).pipe(
      Effect.provide(Engine.nodePlatformLayer),
      dieOnFailure,
      labelled('the vm runner failed'),
    )

const HOST_BOUND = {
  timeout: INTERRUPT_AFTER_MS,
  reason: 'each side runs a real vitest instance or the vm worker over the host filesystem and child processes',
} as const

const COMPARE_OPTIONS = { runBudget: 1, hostBound: HOST_BOUND } as const

const traced = (side: string) => <I, A>(run: (input: I) => Effect.Effect<A>) => (input: I): Effect.Effect<A> =>
  TestTelemetry.underActiveTestSpan(run(input).pipe(Effect.withSpan(`vm_parity.${side}`))).pipe(
    Effect.provide(TestTelemetry.layer({ 'vm_parity.component': 'differential' })),
  )

const reference = traced('reference')
const candidate = traced('candidate')

for (const fixture of FIXTURES) {
  Differential.compare({
    name: `vm parity: fixture ${fixture.name} test outcomes match real vitest`,
    reference: reference(realFixtureOutcomes),
    candidate: candidate(vmFixtureOutcomes),
  })
    .on(fc.constant(fixture), COMPARE_OPTIONS)
    .assert(sameOutcomes)
}

for (const fixture of FIXTURES.filter((entry) => entry.mutants)) {
  Differential.compare({
    name: `vm parity: fixture ${fixture.name} mutant verdicts match real vitest`,
    reference: reference(realMutantVerdicts),
    candidate: candidate(mutationEngineVerdicts),
  })
    .on(fc.constant(fixture), COMPARE_OPTIONS)
    .assert(verdictsAgree)
}

Differential.compare({
  name: 'vm parity: generated suite outcomes match real vitest',
  reference: reference(generatedRealOutcomes),
  candidate: candidate(generatedVmOutcomes),
})
  .on(generatedSuites, { runBudget: 12, hostBound: HOST_BOUND })
  .assert(sameOutcomes)
