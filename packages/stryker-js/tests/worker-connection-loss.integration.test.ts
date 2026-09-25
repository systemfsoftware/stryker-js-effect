import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Worker } from '@systemfsoftware/stryker-js'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Checker, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as TestClock from 'effect/testing/TestClock'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'

import { memorySocketPair, singleConnection } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it })

const SILENCE_WINDOW = '20 seconds'
const ORPHAN_GUARD = '30 seconds'
const BOOT_REFUSALS = 2
const BOOT_RETRY_WINDOW = '5 seconds'

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never

interface SilentWorkerHarness {
  readonly client: RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>
  readonly gate: Latch.Latch
  readonly received: Ref.Ref<readonly Checker.CheckerMutantWire[]>
}

const busySocket = (gate: Latch.Latch, socket: Socket.Socket): Socket.Socket =>
  Socket.make({
    reader: Effect.map(socket.reader, (reader) => ({ ...reader, pull: Effect.andThen(gate.await, reader.pull) })),
    writer: socket.writer,
  })

const makeSilentCheckerServer = (
  socket: Socket.Socket,
  received: Ref.Ref<readonly Checker.CheckerMutantWire[]>,
): Layer.Layer<never> =>
  RpcServer.layer(Plugin.CheckerRpcs).pipe(
    Layer.provide(
      Plugin.CheckerRpcs.toLayer({
        check: ({ mutants }) =>
          Ref.set(received, mutants).pipe(
            Effect.map(() => Object.fromEntries(mutants.map((mutant) => [mutant.id, { status: 'passed' as const }]))),
          ),
        group: ({ mutants }) => Effect.succeed([mutants.map((mutant) => mutant.id)]),
      }),
    ),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
    Layer.provide(Trace.layerTraceContextServer),
  )

const refusingFirstOpens = (refusals: number, socket: Socket.Socket): Socket.Socket => {
  let attempts = 0
  return Socket.make({
    reader: Effect.suspend(() => {
      attempts += 1
      return attempts <= refusals
        ? Effect.fail(
          Socket.SocketError.make({
            reason: Socket.SocketOpenError.make({ kind: 'Unknown', cause: 'the worker socket was not listening yet' }),
          }),
        )
        : socket.reader
    }),
    writer: socket.writer,
  })
}

const makeHarness = (bootRefusals = 0) =>
  Effect.gen(function*() {
    const gate = yield* Latch.make()
    const [clientSocket, serverSocket] = yield* memorySocketPair
    const received = yield* Ref.make<readonly Checker.CheckerMutantWire[]>([])

    yield* Effect.forkScoped(makeSilentCheckerServer(busySocket(gate, serverSocket), received).pipe(Layer.launch))

    const launcherLayer = Layer.succeed(Worker.WorkerLauncher, {
      spawn: () =>
        Effect.succeed(
          Worker.makeSpawnedSocketWorker({
            pid: 4242,
            clientLayer: Worker.layerWorkerProtocol(
              Layer.succeed(Socket.Socket, refusingFirstOpens(bootRefusals, clientSocket)),
            ),
            exited: Effect.never,
          }),
        ),
    })

    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({}).pipe(Effect.orDie)
    const client = yield* Worker.makeWorkerClient({
      entrypoint: '/project/checker.mjs',
      execArgv: [],
      options,
      rpcs: Plugin.CheckerRpcs,
      tempDirPrefix: 'checker-',
      workingDirectory: '/project',
    }).pipe(Effect.provide(launcherLayer))

    return { client, gate, received } satisfies SilentWorkerHarness
  })

const mutantWith = (id: string): Checker.CheckerMutantWire => ({
  id: Mutant.MutantId.make(id),
  fileName: Mutant.CanonicalFileName.make('src/core.ts'),
  mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
  replacement: '-',
  location: { start: { line: 10, column: 5 }, end: { line: 10, column: 6 } },
})

const checkMutants = (harness: SilentWorkerHarness, id: string) =>
  harness.client.check({ checkerName: 'test-checker', mutants: [mutantWith(id)] })

Feature('Settling checker requests against a worker that goes silent or boots slowly')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A request still waiting when its worker goes silent is failed with the connection loss',
      Gherkin.Do.pipe(
        Given('a checker request in flight on a worker that has stopped responding')(
          'held',
          () =>
            Effect.gen(function*() {
              const harness = yield* makeHarness()
              const outcome = yield* Effect.forkChild(
                checkMutants(harness, 'mutant-1').pipe(Effect.flip, Effect.timeout(ORPHAN_GUARD)),
              )
              return { harness, outcome }
            }),
        ),
        When('the host runs out of patience with the silent connection')(
          'elapsed',
          () => TestClock.adjust(SILENCE_WINDOW),
        ),
        Then('the waiting request is failed with the lost connection rather than left waiting forever')((s, expect) =>
          Effect.gen(function*() {
            yield* TestClock.adjust(ORPHAN_GUARD)
            const outcome = yield* Fiber.join(s.held.outcome).pipe(Effect.result)
            return yield* expect(outcome).toSatisfy(
              (result) => Result.isSuccess(result) && S.is(RpcClientError)(result.success),
              'the request fails with a typed RPC client error, not a timeout',
            )
          })
        ),
      ),
    )

    scenario(
      'A request made after the worker responds again is answered',
      Gherkin.Do.pipe(
        Given('a worker that went silent and lost an earlier request with its connection')(
          'silent',
          () =>
            Effect.gen(function*() {
              const harness = yield* makeHarness()
              const lost = yield* Effect.forkChild(
                checkMutants(harness, 'mutant-1').pipe(Effect.flip, Effect.timeout(ORPHAN_GUARD)),
              )
              yield* TestClock.adjust(SILENCE_WINDOW)
              yield* Fiber.join(lost)
              return harness
            }),
        ),
        When('the worker responds again and a new request is made')('answer', (s) =>
          Effect.andThen(
            Effect.andThen(s.silent.gate.open, TestClock.adjust('2 seconds')),
            checkMutants(s.silent, 'mutant-2'),
          )),
        Then('the new request is answered by the recovered worker')((s, expect) =>
          Effect.gen(function*() {
            const received = yield* Ref.get(s.silent.received)
            return { status: s.answer['mutant-2']?.status, lastReceivedId: received.at(-1)?.id }
          }).pipe(Effect.map((facts) => expect(facts).toEqual({ status: 'passed', lastReceivedId: 'mutant-2' })))
        ),
      ),
    )
    scenario(
      'A request made while the worker refuses its connection is answered once it accepts',
      Gherkin.Do.pipe(
        Given('a checker request already waiting on a worker that refuses its connection while booting')(
          'held',
          () =>
            Effect.gen(function*() {
              const booting = yield* makeHarness(BOOT_REFUSALS).pipe(Effect.forkChild)
              const outcome = yield* Effect.flatMap(
                Fiber.join(booting),
                (harness) => checkMutants(harness, 'mutant-boot'),
              ).pipe(Effect.result, Effect.timeout(ORPHAN_GUARD), Effect.forkChild)
              return { booting, outcome }
            }),
        ),
        When('the worker finishes booting and accepts the connection')(
          'booted',
          (s) =>
            Effect.gen(function*() {
              yield* TestClock.adjust(BOOT_RETRY_WINDOW)
              const harness = yield* Fiber.join(s.held.booting)
              yield* Latch.open(harness.gate)
              return harness
            }),
        ),
        Then('the first request is answered by the booted worker')((s, expect) =>
          Effect.gen(function*() {
            const outcome = yield* Fiber.join(s.held.outcome)
            if (Result.isFailure(outcome)) {
              throw new Error('the first request was expected to wait out the worker boot and be answered', {
                cause: outcome.failure,
              })
            }
            const received = yield* Ref.get(s.booted.received)
            return { status: outcome.success['mutant-boot']?.status, lastReceivedId: received.at(-1)?.id }
          }).pipe(Effect.map((facts) => expect(facts).toEqual({ status: 'passed', lastReceivedId: 'mutant-boot' })))
        ),
      ),
    )
  })
