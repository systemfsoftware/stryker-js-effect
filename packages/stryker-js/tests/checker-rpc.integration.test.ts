import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { CheckerRpcs, makeWorkerClient, WorkerLauncher } from '@systemfsoftware/stryker-js'
import { CanonicalFileName, MutantId, MutatorName } from '@systemfsoftware/stryker-js-instrumenter'
import { type CheckerMutantWire, StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { layerTraceContextServer } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'
import { expect } from 'vitest'

import { make as makeSpawnedSocketWorker } from '../src/spawned-socket-worker.handle.js'
import { memorySocketPair, singleConnection } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it, layer })

type CheckerRpcsUnion = typeof CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never

interface CheckerHarness {
  readonly client: RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>
  readonly receivedRef: Ref.Ref<readonly CheckerMutantWire[]>
}

const makeCheckerServer = (
  socket: Socket.Socket,
  receivedRef: Ref.Ref<readonly CheckerMutantWire[]>,
): Layer.Layer<never> =>
  RpcServer.layer(CheckerRpcs).pipe(
    Layer.provide(
      CheckerRpcs.toLayer({
        check: ({ mutants }) =>
          Ref.set(receivedRef, mutants).pipe(
            Effect.map(() =>
              Object.fromEntries(
                mutants.map((m) => [m.id, { status: 'passed' as const }]),
              )
            ),
          ),
        group: ({ mutants }) => Effect.succeed([mutants.map((m) => m.id)]),
      }),
    ),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
    Layer.provide(layerTraceContextServer),
  )

const makeHarness = () =>
  Effect.gen(function*() {
    const [clientSocket, serverSocket] = yield* memorySocketPair
    const receivedRef = yield* Ref.make<readonly CheckerMutantWire[]>([])

    yield* Effect.forkScoped(makeCheckerServer(serverSocket, receivedRef).pipe(Layer.launch))

    const launcherLayer = Layer.succeed(WorkerLauncher, {
      spawn: () =>
        Effect.succeed(
          makeSpawnedSocketWorker({
            pid: 4242,
            clientLayer: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
              Layer.provide(Layer.succeed(Socket.Socket, clientSocket)),
              Layer.provide(RpcSerialization.layerNdjson),
            ),
            exited: Effect.never,
          }),
        ),
    })

    const options = yield* S.decodeEffect(StrykerOptionsSchema)({}).pipe(Effect.orDie)
    const client = yield* makeWorkerClient({
      entrypoint: '/project/checker.mjs',
      execArgv: [],
      options,
      rpcs: CheckerRpcs,
      tempDirPrefix: 'checker-',
      workingDirectory: '/project',
    }).pipe(Effect.provide(launcherLayer))

    return { client, receivedRef } satisfies CheckerHarness
  })

Feature('Verifying mutants through an external checker worker')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'Mutant descriptions travel across the process boundary intact',
      Gherkin.Do.pipe(
        Given('a worker process ready to verify code mutations')('harness', makeHarness),
        When('the runner submits a mutation with line coordinates for verification')(
          'response',
          (s) => {
            const mutant: CheckerMutantWire = {
              id: MutantId.make('mutant-1'),
              fileName: CanonicalFileName.make('src/core.ts'),
              mutatorName: MutatorName.make('ArithmeticOperator'),
              replacement: '-',
              location: {
                start: { line: 10, column: 5 },
                end: { line: 10, column: 6 },
              },
            }

            return s.harness.client.check({
              checkerName: 'test-checker',
              mutants: [mutant],
            })
          },
        ),
        Then('the checker passes the mutant without schema or communication errors')((s) => {
          expect(s.response['mutant-1']?.status).toBe('passed')
        }),
        Then('the worker receives the exact mutation coordinates and text')((s) =>
          Effect.gen(function*() {
            const received = yield* Ref.get(s.harness.receivedRef)
            expect(received).toHaveLength(1)
            expect(received[0]?.id).toBe('mutant-1')
            expect(received[0]?.fileName).toBe('src/core.ts')
            expect(received[0]?.replacement).toBe('-')
            expect(received[0]?.location).toEqual({
              start: { line: 10, column: 5 },
              end: { line: 10, column: 6 },
            })
          })
        ),
      ),
    )
  })
