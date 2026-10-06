import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Plugin as Stryker, Worker } from '@systemfsoftware/stryker-js'
import { Mutant, Options, Plugin, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as S from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'
import * as SocketServer from 'effect/socket/SocketServer'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { memorySocketPair, singleConnection, WORKER_PID } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it })

const MUTANT_BUDGET_MS = 500
const START_UP_MS = 800
const KILLED_AT_MS = 900
const HANGING_START_MS = 10
const SETTLING_WITHOUT_START_MS = 50

const SANDBOX_FILE = 'src/math.ts'
const SANDBOX_WORKING_DIRECTORY = '/project/.stryker-tmp/sandbox-1'
const WORKER_ENTRYPOINT = '/project/node_modules/@acme/stryker-runner/dist/main.mjs'
const KILLING_TEST = TestRunner.TestId.make('test/math.test.mjs#adds two numbers')

const activeMutant = Mutant.Mutant.make({
  id: Mutant.MutantId.make('0000000000000001'),
  fileName: Mutant.CanonicalFileName.make(SANDBOX_FILE),
  mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
  replacement: '-',
  location: { start: { line: 3, column: 10 }, end: { line: 3, column: 11 } },
})

const runOptionsFor = (timeoutMs: number): Mutant.MutantRunOptions => ({
  timeout: timeoutMs,
  disableBail: false,
  activeMutant,
  sandboxFileName: SANDBOX_FILE,
  mutantActivation: 'runtime',
  reloadEnvironment: true,
})

const killedResult: TestRunner.MutantRunResult = {
  status: 'killed',
  killedBy: [KILLING_TEST],
  failureMessage: 'expected 4 to be 5',
  nrOfTests: 1,
  executedTests: [{ id: KILLING_TEST, timeSpentMs: 4 }],
}

const survivedResult: TestRunner.MutantRunResult = {
  status: 'survived',
  nrOfTests: 0,
  executedTests: [],
}

type RunEvents = Stream.Stream<TestRunner.MutantRunEvent, TestRunner.TestRunnerFailed>
type RunOutcome = Result.Result<TestRunner.MutantRunResult, Stryker.PooledTestRunnerError>
type PendingRun = Fiber.Fiber<RunOutcome>

const emittedAfter = (delayMs: number, event: TestRunner.MutantRunEvent): RunEvents =>
  Effect.sleep(Duration.millis(delayMs)).pipe(Effect.as(event), Stream.fromEffect)

const startedEvent = (): TestRunner.MutantRunEvent => TestRunner.MutantRunStarted.make({})

const settledEvent = (result: TestRunner.MutantRunResult): TestRunner.MutantRunEvent =>
  TestRunner.MutantRunSettled.make({ result })

const scheduledRun = (schedule: ReadonlyArray<readonly [number, TestRunner.MutantRunEvent]>): RunEvents =>
  schedule.reduce<RunEvents>(
    (stream, [atMs, event], index) => {
      const previousAtMs = index === 0 ? 0 : schedule[index - 1]?.[0] ?? 0
      return Stream.concat(stream, emittedAfter(atMs - previousAtMs, event))
    },
    Stream.empty,
  )

const runnerStream = (
  schedule: ReadonlyArray<readonly [number, TestRunner.MutantRunEvent]>,
  tail: 'ends' | 'staysOpen',
): RunEvents => Stream.concat(scheduledRun(schedule), tail === 'staysOpen' ? Stream.never : Stream.empty)

const runnerServer = (socket: Socket.Socket, events: RunEvents): Layer.Layer<never> =>
  RpcServer.layer(Plugin.TestRunnerRpcs).pipe(
    Layer.provide(
      Plugin.TestRunnerRpcs.toLayer({
        capabilities: () => Effect.succeed({ reloadEnvironment: true }),
        dryRun: () => Effect.succeed({ status: 'error', errorMessage: 'the substituted runner never dry runs' }),
        mutantRun: () => events,
      }),
    ),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
    Layer.provide(Trace.layerTraceContextServer),
  )

const defaultOptions = S.decodeEffect(Options.StrykerOptionsSchema)({}).pipe(Effect.orDie)

const deadlineOutcome = (events: RunEvents, timeoutMs: number): Effect.Effect<RunOutcome> =>
  Effect.scoped(Effect.gen(function*() {
    const options = yield* defaultOptions
    const [clientSocket, serverSocket] = yield* memorySocketPair
    yield* Effect.forkScoped(runnerServer(serverSocket, events).pipe(Layer.launch))
    const launcher = Layer.succeed(Worker.WorkerLauncher, {
      spawn: () =>
        Effect.succeed(
          Worker.makeSpawnedSocketWorker({
            pid: WORKER_PID,
            clientLayer: Worker.layerWorkerProtocol(Layer.succeed(Socket.Socket, clientSocket)),
            exited: Effect.never,
          }),
        ),
    })
    const runner = yield* Stryker.makeChildProcessTestRunner({
      options,
      fileDescriptions: {},
      sandboxWorkingDirectory: SANDBOX_WORKING_DIRECTORY,
      workerEntrypoint: WORKER_ENTRYPOINT,
      idGenerator: { next: Effect.succeed(1) },
    }).pipe(Effect.provide(launcher))
    return yield* runner.mutantRun(runOptionsFor(timeoutMs))
  })).pipe(Effect.result)

const pendingRun = (events: RunEvents, timeoutMs: number): Effect.Effect<PendingRun> =>
  Effect.forkChild(deadlineOutcome(events, timeoutMs))

const settleOver = (run: PendingRun, window: Duration.Input, note: string): Effect.Effect<RunOutcome> =>
  TestClock.adjust(window).pipe(
    Effect.andThen(Effect.yieldNow),
    Effect.andThen(Effect.suspend(() =>
      run.pollUnsafe() === undefined
        ? Effect.die(new Error(`the mutant deadline was still waiting ${note}`))
        : Fiber.join(run)
    )),
  )

const stillWaitingAfter = (run: PendingRun, window: Duration.Input, note: string): Effect.Effect<void> =>
  TestClock.adjust(window).pipe(
    Effect.andThen(Effect.yieldNow),
    Effect.andThen(
      Effect.suspend(() =>
        run.pollUnsafe() === undefined ? Effect.void : Effect.die(new Error(`the mutant deadline settled ${note}`))
      ),
    ),
  )

const settledOf = (outcome: RunOutcome): Effect.Effect<TestRunner.MutantRunResult> =>
  Result.match(outcome, {
    onFailure: (error) => Effect.die(new Error('the mutant deadline failed instead of settling', { cause: error })),
    onSuccess: (result) => Effect.succeed(result),
  })

const verdictOf = (result: TestRunner.MutantRunResult) => ({
  status: result.status,
  reason: 'reason' in result ? result.reason : undefined,
})

const wallClockTimeout = {
  status: 'timeout',
  reason: TestRunner.WallClockTimeoutReason.literal,
}

Feature('Settling a mutant run against a deadline that starts with its first test')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A mutant whose runner starts after the budget has elapsed is still killed inside it',
      Gherkin.Do.pipe(
        Given('a runner whose first test starts only after the mutant budget has already elapsed')(
          'running',
          () =>
            pendingRun(
              runnerStream(
                [[START_UP_MS, startedEvent()], [KILLED_AT_MS, settledEvent(killedResult)]],
                'ends',
              ),
              MUTANT_BUDGET_MS,
            ),
        ),
        When('the run settles inside the budget measured from that first test')(
          'settled',
          (s) => settleOver(s.running, Duration.millis(KILLED_AT_MS + 100), 'after the whole run was reported'),
        ),
        Then('the mutant is reported killed rather than timed out')((s, expect) =>
          settledOf(s.settled).pipe(
            Effect.map((result) => expect(verdictOf(result)).toEqual({ status: 'killed' })),
          )
        ),
      ),
    )
    scenario(
      'A mutant whose runner starts and then hangs is timed out on its own budget',
      Gherkin.Do.pipe(
        Given('a runner that reports its first test and then never settles')(
          'running',
          () => pendingRun(runnerStream([[HANGING_START_MS, startedEvent()]], 'staysOpen'), MUTANT_BUDGET_MS),
        ),
        When('the budget measured from that first test runs out')(
          'settled',
          (s) =>
            settleOver(
              s.running,
              Duration.millis(HANGING_START_MS + MUTANT_BUDGET_MS + 100),
              'past the budget of a run that had started',
            ),
        ),
        Then('the mutant is reported timed out by the wall clock')((s, expect) =>
          settledOf(s.settled).pipe(
            Effect.map((result) => expect(verdictOf(result)).toEqual(wallClockTimeout)),
          )
        ),
      ),
    )
    scenario(
      'A mutant whose runner never starts is timed out only once the boot window closes',
      Gherkin.Do.pipe(
        Given('a runner that never reports a first test')(
          'running',
          () => pendingRun(runnerStream([], 'staysOpen'), MUTANT_BUDGET_MS),
        ),
        When('the budget passes without a start and then the boot window closes')(
          'settled',
          (s) =>
            stillWaitingAfter(
              s.running,
              Duration.millis(MUTANT_BUDGET_MS + 100),
              'on the mutant budget instead of the boot window',
            ).pipe(
              Effect.andThen(
                settleOver(
                  s.running,
                  Duration.minutes(1),
                  'past the boot window',
                ),
              ),
            ),
        ),
        Then('the mutant is reported timed out by the wall clock')((s, expect) =>
          settledOf(s.settled).pipe(
            Effect.map((result) => expect(verdictOf(result)).toEqual(wallClockTimeout)),
          )
        ),
      ),
    )
    scenario(
      'A mutant run that settles without ever starting keeps the result it reported',
      Gherkin.Do.pipe(
        Given('a runner that reports a settled run without reporting a first test')(
          'running',
          () =>
            pendingRun(
              runnerStream([[SETTLING_WITHOUT_START_MS, settledEvent(survivedResult)]], 'ends'),
              MUTANT_BUDGET_MS,
            ),
        ),
        When('the run settles')(
          'settled',
          (s) => settleOver(s.running, Duration.millis(SETTLING_WITHOUT_START_MS + 100), 'after its own result'),
        ),
        Then('the result the stream reported comes back unchanged rather than as a timeout')((s, expect) =>
          settledOf(s.settled).pipe(Effect.map((result) => expect(result).toEqual(survivedResult)))
        ),
      ),
    )
  })
