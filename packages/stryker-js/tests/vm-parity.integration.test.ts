import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { ScenarioFn } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration, Engine, Plugin, Worker } from '@systemfsoftware/stryker-js'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { createVitest } from 'vitest/node'
import type { Vitest } from 'vitest/node'

const Feature = makeFeature({ it, layer })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const FIXTURES_ROOT_SEGMENTS: readonly string[] = ['testResources', 'vm-parity']

const workerCanary = Layer.succeed(
  Worker.WorkerLauncher,
  Worker.WorkerLauncher.of({
    spawn: () => Effect.die(new Error('a worker was launched for a vm-parity dry run')),
  }),
)

const spawnerCanary = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.die(new Error('a child process was spawned for a vm-parity dry run'))),
)

const stubPortsLayer = Layer.merge(spawnerCanary, workerCanary)

const sandboxFileLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const engineLayer = Engine.nodePlatformLayer

interface CapturedTest {
  readonly file: string
  readonly fullName: string
  readonly status: TestRunner.TestStatus
}

interface Sandbox {
  readonly root: string
  readonly subroots: readonly string[]
}

interface FixtureResults {
  readonly captured: ReadonlyArray<CapturedTest>
  readonly vm: ReadonlyArray<CapturedTest>
  readonly initError: string | undefined
  readonly verdicts: Record<string, string>
}

interface TaskLike {
  readonly type: string
  readonly name: string
  readonly mode: string
  readonly suite?: TaskLike | undefined
  readonly result?: { readonly state?: string } | undefined
  readonly tasks?: readonly TaskLike[] | undefined
}

interface FileLike {
  readonly filepath: string
  readonly tasks: readonly TaskLike[]
}

const VITEST_RUNNER_VERDICT_REFERENCES: Record<string, Record<string, string>> = {
  mocking: {
    'src/automock-target.ts:1:21:ArrowFunction:() => undefined': 'Survived',
    'src/automock-target.ts:1:62:ArithmeticOperator:left - right': 'Survived',
    'src/automock-target.ts:10:24:BlockStatement:{}': 'Survived',
    'src/automock-target.ts:11:6:AssignmentOperator:this.count -= 1': 'Survived',
    'src/automock-target.ts:3:25:ObjectLiteral:{}': 'Killed',
    'src/automock-target.ts:4:11:ArrowFunction:() => undefined': 'Survived',
    'src/automock-target.ts:4:38:StringLiteral:``': 'Survived',
    'src/builtin-user.ts:3:24:ArrowFunction:() => undefined': 'Killed',
    'src/do-mock-target.ts:1:21:ArrowFunction:() => undefined': 'Killed',
    'src/do-mock-target.ts:1:35:StringLiteral:""': 'Killed',
    'src/format.ts:1:27:ArrowFunction:() => undefined': 'Killed',
    'src/format.ts:1:54:MethodExpression:value.toLowerCase()': 'Killed',
    'src/format.ts:3:23:ArrowFunction:() => undefined': 'Killed',
    'src/format.ts:3:49:StringLiteral:``': 'Killed',
    'src/hoisted-target.ts:1:23:ArrowFunction:() => undefined': 'Survived',
    'src/hoisted-target.ts:1:37:StringLiteral:""': 'Survived',
    'src/isolation-target.ts:1:24:ArrowFunction:() => undefined': 'Killed',
    'src/isolation-target.ts:1:38:StringLiteral:""': 'Killed',
    'src/manual-target.ts:1:23:ArrowFunction:() => undefined': 'Survived',
    'src/manual-target.ts:1:37:StringLiteral:""': 'Survived',
    'src/reset-state.ts:3:36:BlockStatement:{}': 'Killed',
    'src/reset-state.ts:4:4:AssignmentOperator:state -= 1': 'Killed',
    'src/reset-state.ts:8:25:ArrowFunction:() => undefined': 'Killed',
    'src/spy-target.ts:1:26:ArrowFunction:() => undefined': 'Killed',
    'src/spy-target.ts:1:67:ArithmeticOperator:left / right': 'Killed',
    'src/unmock-target.ts:1:22:ArrowFunction:() => undefined': 'Killed',
    'src/unmock-target.ts:1:37:BooleanLiteral:false': 'Killed',
  },
  snapshots: {
    'src/math.ts:1:21:ArrowFunction:() => undefined': 'Survived',
    'src/math.ts:1:62:ArithmeticOperator:left - right': 'Survived',
    'src/math.ts:3:24:ArrowFunction:() => undefined': 'Killed',
    // Real Vitest verdict: the published vitest runner misses nested-suite tests here (stryker-js-effect#92).
    'src/math.ts:3:51:ArithmeticOperator:value / value': 'Killed',
    'src/summary.ts:6:24:ArrowFunction:() => undefined': 'Killed',
    'src/summary.ts:6:65:ObjectLiteral:{}': 'Killed',
    'src/summary.ts:8:26:ArrowFunction:() => undefined': 'Killed',
    'src/summary.ts:8:57:ObjectLiteral:{}': 'Killed',
  },
  hangs: {
    'src/loop.ts:1:55:BlockStatement:{}': 'Killed',
    'src/loop.ts:4:11:ConditionalExpression:false': 'Killed',
    'src/loop.ts:4:11:EqualityOperator:step <= limit': 'Killed',
    'src/loop.ts:4:11:EqualityOperator:step >= limit': 'Killed',
    'src/loop.ts:4:25:BlockStatement:{}': 'Killed',
    'src/loop.ts:5:14:ArithmeticOperator:total - step': 'Killed',
    'src/loop.ts:6:13:ArithmeticOperator:step - 1': 'Killed',
  },
  config: {
    'src/impl-custom.ts:1:24:ArrowFunction:() => undefined': 'Killed',
    'src/impl-custom.ts:1:38:StringLiteral:""': 'Killed',
    'src/impl-default.ts:1:24:ArrowFunction:() => undefined': 'RuntimeError',
    'src/impl-default.ts:1:38:StringLiteral:""': 'RuntimeError',
    'src/setup.ts:5:13:StringLiteral:""': 'Killed',
    'src/setup.ts:5:30:StringLiteral:""': 'Killed',
    'src/setup.ts:7:19:BlockStatement:{}': 'Killed',
    'src/setup.ts:8:4:AssignmentOperator:setupHookRuns -= 1': 'Killed',
    'src/setup.ts:9:15:StringLiteral:""': 'Killed',
    'src/sum.ts:1:21:ArrowFunction:() => undefined': 'Killed',
    'src/sum.ts:1:62:ArithmeticOperator:left - right': 'Killed',
    'src/sum.ts:3:26:BlockStatement:{}': 'Survived',
    'src/sum.ts:3:6:ConditionalExpression:false': 'Survived',
    'src/sum.ts:3:6:ConditionalExpression:true': 'Survived',
    'src/sum.ts:5:48:BlockStatement:{}': 'Survived',
    'src/sum.ts:5:9:StringLiteral:""': 'Survived',
  },
  'runner-api': {
    'src/counter.ts:1:24:ArrowFunction:() => undefined': 'Killed',
    'src/counter.ts:1:51:ArithmeticOperator:value / 2': 'Killed',
    'src/counter.ts:3:24:ArrowFunction:() => undefined': 'Survived',
    'src/counter.ts:3:77:ArrowFunction:() => undefined': 'Survived',
    'src/counter.ts:3:95:ArithmeticOperator:total - value': 'Survived',
    'src/flaky.ts:11:31:ArrowFunction:() => undefined': 'Survived',
    'src/flaky.ts:3:37:BlockStatement:{}': 'Killed',
    'src/flaky.ts:4:4:AssignmentOperator:attempts -= 1': 'Survived',
    'src/flaky.ts:5:24:BlockStatement:{}': 'Survived',
    'src/flaky.ts:5:8:ConditionalExpression:false': 'Survived',
    'src/flaky.ts:5:8:ConditionalExpression:true': 'Killed',
    'src/flaky.ts:5:8:EqualityOperator:attempts !== 1': 'Survived',
    'src/flaky.ts:6:22:StringLiteral:""': 'Survived',
    'src/flaky.ts:8:11:StringLiteral:""': 'Killed',
  },
}

const statusOf = (task: TaskLike): TestRunner.TestStatus => {
  if (task.mode === 'skip' || task.mode === 'todo' || task.result?.state === 'skip') {
    return 'skipped'
  }
  if (task.result?.state === 'fail') {
    return 'failed'
  }
  return task.result?.state === 'pass' ? 'success' : 'skipped'
}

interface RawCaptured {
  readonly filepath: string
  readonly fullName: string
  readonly status: TestRunner.TestStatus
}

const captureFile = (file: FileLike): ReadonlyArray<RawCaptured> => {
  const captured: RawCaptured[] = []
  const visit = (task: TaskLike, ancestors: readonly string[]): void => {
    if (task.type === 'suite') {
      const nested = [...ancestors, task.name]
      for (const child of task.tasks ?? []) {
        visit(child, nested)
      }
      return
    }
    captured.push({
      filepath: file.filepath,
      fullName: [...ancestors, task.name].join(' > '),
      status: statusOf(task),
    })
  }
  for (const task of file.tasks) {
    visit(task, [])
  }
  return captured
}

const captureVitest = (directory: string): Promise<ReadonlyArray<RawCaptured>> =>
  createVitest({ root: directory, watch: false, update: true }).then((vitest: Vitest) => {
    const run = vitest.start().then(() =>
      (vitest.state.getFiles() as readonly FileLike[]).flatMap((file) => captureFile(file))
    )
    return run.finally(() => {
      vitest.close().catch(() => {})
    })
  })

const prepareSandbox = (feature: string, subroots: readonly string[]) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fixturesRoot = path.join(PACKAGE_ROOT, ...FIXTURES_ROOT_SEGMENTS)
    const root = yield* fs.makeTempDirectory({ prefix: `vm-parity-${feature}-` })
    yield* fs.copy(path.join(fixturesRoot, feature), root, { overwrite: true })
    yield* fs.remove(path.join(root, 'node_modules'), { recursive: true, force: true })
    yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
    return { root, subroots }
  }).pipe(Effect.provide(sandboxFileLayer), Effect.orDie)

const removeSandbox = (sandbox: Sandbox) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(sandbox.root, { recursive: true, force: true })
  }).pipe(Effect.provide(sandboxFileLayer), Effect.ignore)

const contextFor = (defaults: Options.StrykerOptions, directory: string): Plugin.TestRunnerBuildContext => ({
  options: { ...defaults, testRunner: 'vm' },
  fileDescriptions: {},
  sandboxWorkingDirectory: directory,
  idGenerator: { next: Effect.succeed(1) },
  retire: Effect.void,
  testFiles: [],
})

const describeFailure = (failure: Plugin.PooledTestRunnerError): string =>
  Match.value(failure).pipe(
    Match.tag('TestRunnerFailed', (typed) => `${typed.phase}: ${typed.cause}`),
    Match.orElse((other) => String(other)),
  )

const withVmRunner = <A, E, R>(
  directory: string,
  use: (runner: Plugin.PooledTestRunner) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function*() {
    const defaults = yield* Configuration.StrykerConfig.createDefaultOptions
    const neverSpawned = Effect.die(new Error('the child-process runner was built for a vm-parity run'))
    return yield* Effect.flatMap(Plugin.buildTestRunner(contextFor(defaults, directory), neverSpawned), use)
  }).pipe(
    Effect.provide(Layer.mergeAll(sandboxFileLayer, stubPortsLayer)),
    Effect.scoped,
    Effect.orDie,
  )

const asStatus = (status: string): TestRunner.TestStatus =>
  status === 'success' || status === 'failed' || status === 'skipped' ? status : 'skipped'

const toCaptured = (
  test: { readonly id: string; readonly name: string; readonly status: string },
  subroot: string,
): CapturedTest => {
  const hash = test.id.lastIndexOf('#')
  const file = hash === -1 ? '' : test.id.slice(0, hash)
  return {
    file: subroot === '.' ? file : `${subroot}/${file}`,
    fullName: test.name,
    status: asStatus(test.status),
  }
}

const keyOf = (test: CapturedTest): string => `${test.file}#${test.fullName}`

const diffLines = (
  expected: ReadonlyArray<CapturedTest>,
  actual: ReadonlyArray<CapturedTest>,
): readonly string[] => {
  const expectedByKey: Record<string, CapturedTest> = {}
  for (const test of expected) {
    expectedByKey[keyOf(test)] = test
  }
  const actualByKey: Record<string, CapturedTest> = {}
  for (const test of actual) {
    actualByKey[keyOf(test)] = test
  }
  const lines: string[] = []
  for (const [key, expectedTest] of Object.entries(expectedByKey)) {
    const vmTest = actualByKey[key]
    if (vmTest === undefined) {
      lines.push(`missing in vm: ${key}`)
    } else if (vmTest.status !== expectedTest.status) {
      lines.push(`status differs: ${key}: vitest=${expectedTest.status} vm=${vmTest.status}`)
    }
  }
  for (const key of Object.keys(actualByKey)) {
    if (expectedByKey[key] === undefined) {
      lines.push(`extra in vm: ${key}`)
    }
  }
  return lines.sort()
}

const mutantKey = (file: string, mutant: Mutant.RunMutantResult): string =>
  `${file}:${mutant.location.start.line}:${mutant.location.start.column}:${mutant.mutatorName}:${mutant.replacement}`

const verdictDiff = (
  actual: Record<string, string>,
  reference: Record<string, string>,
): readonly string[] => {
  const lines: string[] = []
  for (const [key, referenceStatus] of Object.entries(reference)) {
    const actualStatus = actual[key]
    if (actualStatus === undefined) {
      lines.push(`${key}: missing in the in-memory run (reference=${referenceStatus})`)
    } else if (actualStatus !== referenceStatus) {
      lines.push(`${key}: reference=${referenceStatus} in-memory=${actualStatus}`)
    }
  }
  for (const [key, actualStatus] of Object.entries(actual)) {
    if (reference[key] === undefined) {
      lines.push(`${key}: extra in the in-memory run (status=${actualStatus})`)
    }
  }
  return lines.sort()
}

const MUTATION_RUN_OPTIONS = {
  testRunner: 'vm',
  testFiles: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'spec/**/*.spec.ts'],
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

const runMutationEngine = (sandboxRoot: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(sandboxRoot)
      return previous
    }),
    () =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const done = yield* Engine.strykerCell(MUTATION_RUN_OPTIONS)
        const verdicts: Record<string, string> = {}
        for (const result of done.results) {
          verdicts[mutantKey(path.relative(sandboxRoot, result.fileName), result)] = result.status
        }
        return verdicts
      }),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  ).pipe(Effect.provide(engineLayer))

const analyze = (feature: string, sandbox: Sandbox, withMutation: boolean) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const captured: CapturedTest[] = []
    for (const subroot of sandbox.subroots) {
      const directory = path.join(sandbox.root, subroot)
      const raw = yield* Effect.promise(() => captureVitest(directory)).pipe(Effect.orDie)
      captured.push(...raw.map((entry) => ({
        file: subroot === '.'
          ? path.relative(directory, entry.filepath)
          : `${subroot}/${path.relative(directory, entry.filepath)}`,
        fullName: entry.fullName,
        status: entry.status,
      })))
    }
    const vm: CapturedTest[] = []
    let initError: string | undefined
    let verdicts: Record<string, string> = {}
    for (const subroot of sandbox.subroots) {
      yield* withVmRunner(path.join(sandbox.root, subroot), (runner) =>
        Effect.gen(function*() {
          if (initError !== undefined) {
            return
          }
          const dry = yield* Effect.result(runner.dryRun({
            timeout: 180_000,
            coverageAnalysis: 'off',
            disableBail: false,
          }))
          if (Result.isFailure(dry)) {
            initError = describeFailure(dry.failure)
            return
          }
          if (dry.success.status !== 'complete') {
            initError = dry.success.status === 'error'
              ? `the vm dry run failed: ${dry.success.errorMessage}`
              : `the vm dry run ended in ${dry.success.status}`
            return
          }
          const failed = dry.success.tests.filter((test) => test.status === 'failed')
          if (failed.length > 0) {
            initError = [
              `the vm dry run reported ${failed.length} failed test(s):`,
              ...failed.map((test) => `  ${test.id}: ${test.failureMessage}`),
            ].join('\n')
            return
          }
          vm.push(...dry.success.tests.map((test) => toCaptured(test, subroot)))
        }))
    }
    if (initError === undefined && withMutation) {
      verdicts = yield* runMutationEngine(sandbox.root)
    }
    return { captured, vm, initError, verdicts }
  }).pipe(Effect.provide(Path.layer))

const sandboxMissing = (captured: ReadonlyArray<CapturedTest>): string | undefined =>
  captured.length === 0 ? 'real vitest reported no tests' : undefined

const divergenceTable = (results: FixtureResults): string | undefined => {
  if (results.initError !== undefined) {
    return `the in-memory runner failed to come up: ${results.initError}`
  }
  const lines = diffLines(results.captured, results.vm)
  return lines.length === 0 ? undefined : [
    `${lines.length} test(s) diverge between real vitest and the in-memory runner`,
    ...lines,
  ].join('\n')
}

const verdictMismatch = (results: FixtureResults, reference: Record<string, string>): string | undefined => {
  const lines = verdictDiff(results.verdicts, reference)
  return lines.length === 0
    ? undefined
    : [
      `${lines.length} mutant(s) of ${Object.keys(reference).length} diverge from the vitest runner reference`,
      ...lines,
    ].join('\n')
}

Feature('Running every vitest suite through the in-memory runner with the same outcomes as real vitest', {
  timeout: 1_800_000,
})
  .withLayer(Layer.empty)
  .liveClock()
  .body(({ scenario }) => {
    const register = (
      scenario: ScenarioFn,
      feature: string,
      subroots: readonly string[],
      reference: Record<string, string> | undefined,
    ): void => {
      const label = `vm-parity/${feature}`
      if (reference === undefined) {
        scenario(
          `The ${feature} fixture reports the same tests through the in-memory runner`,
          Gherkin.Do.pipe(
            Given(`the ${feature} fixture is copied into a sandbox with its dependencies linked`)(
              'sandbox',
              () => prepareSandbox(feature, subroots),
            ),
            When('real vitest runs the sandbox and the in-memory runner replays it')(
              'results',
              (s) =>
                analyze(feature, s.sandbox, false).pipe(
                  Effect.ensuring(removeSandbox(s.sandbox)),
                  Effect.orDie,
                ),
            ),
            Then('real vitest ran at least one test to compare against')((s) => {
              const problem = sandboxMissing(s.results.captured)
              if (problem !== undefined) {
                throw new Error(`${label}: ${problem}`)
              }
            }),
            Then('the in-memory runner reports every test with the same outcome')((s) => {
              const problem = divergenceTable(s.results)
              if (problem !== undefined) {
                throw new Error(`${label}: ${problem}`)
              }
            }),
          ),
        )
        return
      }
      scenario(
        `The ${feature} fixture reports the same tests and mutant verdicts through the in-memory runner`,
        Gherkin.Do.pipe(
          Given(`the ${feature} fixture is copied into a sandbox with its dependencies linked`)(
            'sandbox',
            () => prepareSandbox(feature, subroots),
          ),
          When('real vitest, the in-memory replay, and the mutation run all execute')(
            'results',
            (s) =>
              analyze(feature, s.sandbox, true).pipe(
                Effect.ensuring(removeSandbox(s.sandbox)),
                Effect.orDie,
              ),
          ),
          Then('real vitest ran at least one test to compare against')((s) => {
            const problem = sandboxMissing(s.results.captured)
            if (problem !== undefined) {
              throw new Error(`${label}: ${problem}`)
            }
          }),
          Then('the in-memory runner reports every test with the same outcome')((s) => {
            const problem = divergenceTable(s.results)
            if (problem !== undefined) {
              throw new Error(`${label}: ${problem}`)
            }
          }),
          Then('every mutant keeps the verdict the vitest runner gave it')((s) => {
            const problem = verdictMismatch(s.results, reference)
            if (problem !== undefined) {
              throw new Error(`${label}: ${problem}`)
            }
          }),
        ),
      )
    }

    register(scenario, 'mocking', ['.'], VITEST_RUNNER_VERDICT_REFERENCES['mocking'])
    register(scenario, 'snapshots', ['.'], VITEST_RUNNER_VERDICT_REFERENCES['snapshots'])
    register(scenario, 'hangs', ['.'], VITEST_RUNNER_VERDICT_REFERENCES['hangs'])
    register(scenario, 'environments', ['.', 'node'], undefined)
    register(scenario, 'config', ['.'], VITEST_RUNNER_VERDICT_REFERENCES['config'])
    register(scenario, 'transforms', ['.'], undefined)
    register(scenario, 'runner-api', ['.'], VITEST_RUNNER_VERDICT_REFERENCES['runner-api'])
    register(scenario, 'projects', ['.'], undefined)
  })
