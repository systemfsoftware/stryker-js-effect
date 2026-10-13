import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
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

const Feature = makeFeature({ it })

const PHASE = 'instrument'
const GATHER = 'stryker.instrument.gather'
const ACQUIRE = 'stryker.sandbox.acquire'
const MARK = 'stryker.phase.entered'

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

interface PhaseObservation {
  readonly succeeded: boolean
  readonly phaseSpans: number
  readonly insidePhase: ReadonlyArray<string>
  readonly markEndsBeforeGather: boolean
}

const configTextOf = S.encodeEffect(S.fromJsonString(S.Unknown))

const writeProject = (
  config: Options.PartialStrykerOptions,
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-instrument-phase-' }))
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

const nanosOf = ([seconds, nanos]: ReadableSpan['startTime']): number => seconds * 1e9 + nanos

const within = (span: ReadableSpan, outer: ReadableSpan): boolean =>
  nanosOf(outer.startTime) <= nanosOf(span.startTime) && nanosOf(span.endTime) <= nanosOf(outer.endTime)

const observationOf = (
  succeeded: boolean,
  spans: ReadonlyArray<ReadableSpan>,
  watched: ReadonlyArray<string>,
): PhaseObservation => {
  const phases = spans.filter((span) => span.name === PHASE)
  const insidePhase = (span: ReadableSpan): boolean => phases.some((phase) => within(span, phase))
  const gathers = spans.filter((span) => span.name === GATHER)
  const marks = spans.filter((span) => span.name === MARK && insidePhase(span))
  const [mark] = marks
  const [gather] = gathers
  return {
    succeeded,
    phaseSpans: phases.length,
    insidePhase: watched.filter((name) => spans.some((span) => span.name === name && insidePhase(span))),
    markEndsBeforeGather: marks.length === 1 && gathers.length === 1 && mark !== undefined &&
      gather !== undefined && nanosOf(mark.endTime) <= nanosOf(gather.startTime),
  }
}

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

const spanCapture = () => {
  const exporter = new InMemorySpanExporter()
  const layer = NodeSdk.layer(() => ({
    resource: { serviceName: 'instrument-phase-test' },
    spanProcessor: new SimpleSpanProcessor(exporter),
  }))
  return { exporter, layer }
}

const observe = (
  command: Command,
  watched: ReadonlyArray<string>,
  root: string,
): Effect.Effect<PhaseObservation, never, Engine.EnginePorts | FileSystem.FileSystem> => {
  const telemetry = spanCapture()
  return insideProject(
    root,
    commandOf(command, root).pipe(
      Effect.map((succeeded) => observationOf(succeeded, telemetry.exporter.getFinishedSpans(), watched)),
      Effect.provide(telemetry.layer),
    ),
  )
}

type RunFailure = { readonly stage: string; readonly reason: string } | 'none'

interface FailedRunObservation {
  readonly failure: RunFailure
  readonly phases: ReadonlyArray<string>
  readonly spanRun: { readonly failure: RunFailure; readonly spans: PhaseObservation }
}

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

const failedRunSpansOf = (): Effect.Effect<FailedRunObservation['spanRun'], never, Engine.EnginePorts> => {
  const telemetry = spanCapture()
  return Effect.result(Engine.strykerCell({ dryRunOnly: true })).pipe(
    Effect.map((result) => ({
      failure: failureOf(result),
      spans: observationOf(Result.isSuccess(result), telemetry.exporter.getFinishedSpans(), [GATHER, ACQUIRE]),
    })),
    Effect.provide(telemetry.layer),
  )
}

const observeFailedBuild = (
  root: string,
): Effect.Effect<FailedRunObservation, never, Engine.EnginePorts | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const events = yield* insideProject(root, failedRunEventsOf(root))
    const spanRoot = yield* Effect.orDie(writeProject(FAILING_BUILD_OPTIONS))
    const spanRun = yield* insideProject(spanRoot, failedRunSpansOf())
    return { ...events, spanRun }
  })

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Timing the instrument phase over the instrumenter and the sandbox copy')
  .withLayer(runLayer)
  .live(
    'the scenarios run real dry-run-only runs and plans in a real project directory, so no mutant executes, and the OpenTelemetry span exporter schedules its export on a real timer',
  )
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A <command> enters the instrument phase before it instruments, so <watched> fall inside the phase',
      [
        { command: 'run', watched: [GATHER, ACQUIRE] },
        { command: 'plan', watched: [GATHER] },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project with one mutated source file and one passing test')('root', () =>
            writeProject(PROJECT_OPTIONS)),
          When(`stryker ${row.command} finishes its dry run`)('observed', (s) =>
            observe(row.command, row.watched, s.root)),
          Then(
            'one instrument phase span holds the instrumenter and sandbox work, and its phase mark is entered before instrumentation starts',
          )((s, expect) =>
            expect(s.observed).toEqual({
              succeeded: true,
              phaseSpans: 1,
              insidePhase: row.watched,
              markEndsBeforeGather: true,
            })
          ),
        ),
    )
    scenario(
      'A run whose sandbox build fails stops in the instrument phase it has already entered',
      Gherkin.Do.pipe(
        Given('a project whose build command fails')('root', () => writeProject(FAILING_BUILD_OPTIONS)),
        When('stryker run starts its dry run')('observed', (s) => observeFailedBuild(s.root)),
        Then(
          'the run fails building its sandbox in the instrument stage, after reporting the instrument phase entered, and the failed gathering and sandbox work stay inside the one instrument phase span',
        )(
          (s, expect) =>
            expect(s.observed).toEqual({
              failure: { stage: 'instrument', reason: 'Sandbox initialization failed' },
              phases: ['prepare', 'instrument'],
              spanRun: {
                failure: { stage: 'instrument', reason: 'Sandbox initialization failed' },
                spans: { succeeded: false, phaseSpans: 1, insidePhase: [GATHER, ACQUIRE], markEndsBeforeGather: true },
              },
            }),
        ),
      ),
    )
  })
