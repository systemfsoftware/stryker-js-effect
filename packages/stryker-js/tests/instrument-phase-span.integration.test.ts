import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Contract, ObservationWindow, Rel, Stimulus } from '@systemfsoftware/trace-spec'
import { type Span, Taxonomy } from '@systemfsoftware/trace-taxonomy'
import type * as Cause from 'effect/Cause'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'

import {
  InstrumentGather as Gather,
  InstrumentPhase,
  PhaseEntered,
  SandboxAcquire as Acquire,
} from './__fixtures__/declared-spans.fixture.js'
import { finishedBeforeStart, withinTime, withinTimeOfCount } from './__fixtures__/trace-relations.fixture.js'

const PACKAGE_MODULES = decodeURIComponent(new URL('../node_modules', import.meta.url).pathname)

const Feature = makeFeature({ it })

const InstrumentTaxonomy = Taxonomy.make('instrument-phase').pipe(
  Taxonomy.add(InstrumentPhase),
  Taxonomy.add(Gather),
  Taxonomy.add(Acquire),
  Taxonomy.add(PhaseEntered),
)

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const TEST = [
  "import { expect, test } from 'vitest'",
  "import { add } from '../src/math.ts'",
  '',
  "test('adds one and one', () => {",
  '  expect(add(1, 1)).toBe(2)',
  '})',
].join('\n')

const PROJECT_OPTIONS = {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  reporters: [],
  checkers: [],
  coverageAnalysis: 'perTest',
} as const

const PLAN_REQUEST = {
  targetSeconds: 1,
  maxShards: 1,
  projects: ['.'],
  out: 'plan.json',
  full: false,
} satisfies Engine.PlanRequestInput['request']

const configTextOf = S.encodeEffect(S.fromJsonString(S.Unknown))

const writeProject = (
  config: Options.PartialStrykerOptions,
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-instrument-phase-' }))
    yield* fs.symlink(PACKAGE_MODULES, path.join(root, 'node_modules'))
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'src/math.ts'), SOURCE)
    yield* fs.writeFileString(path.join(root, 'test/math.test.mjs'), TEST)
    const configText = yield* Effect.orDie(configTextOf(config))
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), `export default ${configText}\n`)
    return root
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

const insideProject = <A, R>(
  root: string,
  effect: Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R | FileSystem.FileSystem> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => globalThis.process.chdir(previous)),
  ).pipe(Effect.ensuring(removeProject(root)))

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

type Command = 'run' | 'plan'

const commandOf = (
  command: Command,
  root: string,
): Effect.Effect<boolean, never, Engine.EnginePorts> =>
  command === 'run'
    ? Effect.map(Effect.result(Engine.strykerCell({ ...PROJECT_OPTIONS, dryRunOnly: true })), Result.isSuccess)
    : Effect.gen(function*() {
      const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
      const consoleService = yield* Console.Console
      return yield* Effect.map(
        Effect.result(Engine.planRequest({
          request: PLAN_REQUEST,
          channel: {
            environment: {
              basePath: root,
              host: { env: environmentFor(root), events: queue },
              console: consoleService,
            },
          },
        })),
        Result.isSuccess,
      )
    })

type RunFailure = { readonly stage: string; readonly reason: string } | 'none'

const FAILING_BUILD_OPTIONS = { ...PROJECT_OPTIONS, buildCommand: 'exit 1' } as const

const failureOf = <A>(result: Result.Result<A, Engine.StageError | PlatformError>): RunFailure =>
  Result.match(result, {
    onFailure: (error) =>
      S.is(Engine.StageError)(error) ? { stage: error.stage, reason: error.reason } : { stage: 'platform', reason: '' },
    onSuccess: () => 'none' as const,
  })

const failedRunEventsOf = (root: string) =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const stageLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.layerStage(environmentFor(root), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const result = yield* Engine.mutationTestCell
      .run({ cliOptions: { dryRunOnly: true }, targetMutatePatterns: undefined })
      .pipe(Effect.provide(stageLayer), Effect.scoped, Effect.result)
    const events = yield* Queue.takeAll(queue).pipe(
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    return {
      failure: failureOf(result),
      phases: events.flatMap((event) => S.is(RunEvent.PhaseEntered)(event) ? [event.phase] : []),
    }
  })

interface InstrumentRun {
  readonly failure: RunFailure
}

const dryRunInstrument = Stimulus.make({
  name: 'stryker.dry_run_instrument',
  run: (
    { input }: { readonly input: { readonly command: Command; readonly root: string } },
  ): Effect.Effect<InstrumentRun, never, Engine.EnginePorts | FileSystem.FileSystem> =>
    insideProject(
      input.root,
      commandOf(input.command, input.root).pipe(
        Effect.map((succeeded): InstrumentRun => ({ failure: succeeded ? 'none' : { stage: 'platform', reason: '' } })),
      ),
    ),
})

const dryRunFailingBuild = Stimulus.make({
  name: 'stryker.dry_run_failing_build',
  run: (
    _context: { readonly input: null },
  ): Effect.Effect<InstrumentRun, never, Engine.EnginePorts | FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function*() {
      const root = yield* Effect.orDie(writeProject(FAILING_BUILD_OPTIONS))
      return yield* insideProject(
        root,
        Effect.result(Engine.strykerCell({ dryRunOnly: true })).pipe(
          Effect.map((result): InstrumentRun => ({ failure: failureOf(result) })),
        ),
      )
    }),
})

const gatheredInsideInstrumentPhase = (watched: ReadonlyArray<Span.Span>) =>
  Rel.all(
    Rel.unique(InstrumentPhase),
    ...watched.map((span) => withinTime({ container: InstrumentPhase, spec: span })),
    withinTimeOfCount({ container: InstrumentPhase, spec: PhaseEntered, count: 1 }),
    Rel.unique(Gather),
    finishedBeforeStart({ container: InstrumentPhase, before: PhaseEntered, after: Gather }),
  )

const instrumentContractFor = (watched: ReadonlyArray<Span.Span>) =>
  Contract.of(InstrumentTaxonomy).stimulate(dryRunInstrument).holds(gatheredInsideInstrumentPhase(watched))

const runContract = instrumentContractFor([Gather, Acquire])
const planContract = instrumentContractFor([Gather])

const failedBuildContract = Contract.of(InstrumentTaxonomy).stimulate(dryRunFailingBuild).holds(
  gatheredInsideInstrumentPhase([Gather, Acquire]),
)

const runLayer = Layer.mergeAll(
  Engine.nodePlatformLayer,
  Stdio.layerTest({}),
  ObservationWindow.make('instrument-phase-test').layer,
  NodeFileSystem.layer,
)

Feature('Timing the instrument phase over the instrumenter and the sandbox copy')
  .withLayer(runLayer)
  .live(
    'the scenarios run real dry-run-only runs and plans in a real project directory, so no mutant executes, and the trace observation window reads spans back from an OpenTelemetry exporter that schedules its export on a real timer',
  )
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A <command> enters the instrument phase before it instruments, so <watched> fall inside the phase',
      [
        { command: 'run', watched: 'the gathering and the sandbox acquisition', contract: runContract },
        { command: 'plan', watched: 'the gathering', contract: planContract },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project with one mutated source file and one passing test')('root', () =>
            writeProject(PROJECT_OPTIONS)),
          When(`stryker ${row.command} finishes its dry run`)('judged', (s) =>
            Contract.judge(row.contract, { command: row.command, root: s.root })),
          Then(
            'one instrument phase span holds the instrumenter and sandbox work, and its phase mark is entered before instrumentation starts',
          )((s, expect) =>
            Contract.verdictCheck(row.contract, expect, s.judged)
          ),
          When('the outcome of the command is read back')('run', (s) =>
            Effect.succeed(s.judged.run.output)),
          Then('the command succeeded')((s, expect) => expect(s.run).toEqual({ failure: 'none' })),
        ),
    )
    scenario(
      'A run whose sandbox build fails stops in the instrument phase it has already entered',
      Gherkin.Do.pipe(
        Given('a project whose build command fails')('root', () => writeProject(FAILING_BUILD_OPTIONS)),
        When('stryker run starts its dry run')('events', (s) => insideProject(s.root, failedRunEventsOf(s.root))),
        Then(
          'the run fails building its sandbox in the instrument stage, after reporting the instrument phase entered',
        )((s, expect) =>
          expect(s.events).toEqual({
            failure: { stage: 'instrument', reason: 'Sandbox initialization failed' },
            phases: ['prepare', 'instrument'],
          })
        ),
        When('the same failing run is traced')('judged', () => Contract.judge(failedBuildContract, null)),
        Then(
          'the failed gathering and sandbox work stay inside the one instrument phase span, with its phase mark entered before the gathering',
        )((s, expect) => Contract.verdictCheck(failedBuildContract, expect, s.judged)),
        When('the outcome of the traced run is read back')('run', (s) => Effect.succeed(s.judged.run.output)),
        Then('the traced run fails building its sandbox in the instrument stage')((s, expect) =>
          expect(s.run).toEqual({ failure: { stage: 'instrument', reason: 'Sandbox initialization failed' } })
        ),
      ),
    )
  })
