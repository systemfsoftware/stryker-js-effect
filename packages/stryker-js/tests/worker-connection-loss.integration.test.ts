import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Checker, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as TestClock from 'effect/testing/TestClock'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'
import { expect } from 'vitest'

import { Worker } from '../src/mod.js'
import { memorySocketPair, singleConnection } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it, layer })

const SILENCE_WINDOW = '20 seconds'
const ORPHAN_GUARD = '30 seconds'

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

const makeHarness = () =>
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
            clientLayer: Worker.layerWorkerProtocol(Layer.succeed(Socket.Socket, clientSocket)),
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

Feature('Settling checker requests when a worker goes silent')
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
        Then('the waiting request is failed with the lost connection rather than left waiting forever')((s) =>
          Effect.gen(function*() {
            yield* TestClock.adjust(ORPHAN_GUARD)
            const failure = yield* Fiber.join(s.held.outcome)
            const lost = Match.value(failure).pipe(
              Match.when(S.is(RpcClientError), (error) => Option.some(error.reason)),
              Match.orElse(() => Option.none()),
            )
            const missedPong = Option.flatMap(lost, (reason) =>
              Match.value(reason).pipe(
                Match.tag('SocketOpenError', (open) => Option.some(open)),
                Match.orElse(() => Option.none()),
              ))
            if (Option.isNone(missedPong)) {
              throw new Error('the request was expected to fail with the connection loss', { cause: failure })
            }
            expect(missedPong.value.kind).toBe('Timeout')
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
        Then('the new request is answered by the recovered worker')((s) =>
          Effect.gen(function*() {
            expect(s.answer['mutant-2']?.status).toBe('passed')
            const received = yield* Ref.get(s.silent.received)
            expect(received.at(-1)?.id).toBe('mutant-2')
          })
        ),
      ),
    )
  })
