import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Checker, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'
import { expect } from 'vitest'
import { Checker as StrykerChecker, Worker } from '../src/mod.js'

import { make as makeSpawnedSocketWorker } from '../src/spawned-socket-worker.handle.js'
import { memorySocketPair, singleConnection } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it, layer })

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never

interface CheckerHarness {
  readonly client: RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>
  readonly receivedRef: Ref.Ref<readonly Checker.CheckerMutantWire[]>
}

const makeCheckerServer = (
  socket: Socket.Socket,
  receivedRef: Ref.Ref<readonly Checker.CheckerMutantWire[]>,
): Layer.Layer<never> =>
  RpcServer.layer(Plugin.CheckerRpcs).pipe(
    Layer.provide(
      Plugin.CheckerRpcs.toLayer({
        check: ({ mutants }) =>
          Ref.update(receivedRef, (received) => [...received, ...mutants]).pipe(
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
    Layer.provide(Trace.layerTraceContextServer),
  )

const makeHarness = () =>
  Effect.gen(function*() {
    const [clientSocket, serverSocket] = yield* memorySocketPair
    const receivedRef = yield* Ref.make<readonly Checker.CheckerMutantWire[]>([])

    yield* Effect.forkScoped(makeCheckerServer(serverSocket, receivedRef).pipe(Layer.launch))

    const launcherLayer = Layer.succeed(Worker.WorkerLauncher, {
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

    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({}).pipe(Effect.orDie)
    const client = yield* Worker.makeWorkerClient({
      entrypoint: '/project/checker.mjs',
      execArgv: [],
      options,
      rpcs: Plugin.CheckerRpcs,
      tempDirPrefix: 'checker-',
      workingDirectory: '/project',
    }).pipe(Effect.provide(launcherLayer))

    return { client, receivedRef } satisfies CheckerHarness
  })

const crashedFrom = (error: { readonly message: string }): Worker.ChildProcessCrashedError =>
  Worker.ChildProcessCrashedError.make({ pid: 0, exit: { _tag: 'Code', code: 1 }, cause: error.message })

const serviceFrom = (
  client: RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>,
): StrykerChecker.CheckerResourceService => ({
  check: (checkerName, mutants) =>
    client.check({ checkerName, mutants: [...mutants] }).pipe(Effect.mapError(crashedFrom)),
  group: (checkerName, mutants) =>
    client.group({ checkerName, mutants: [...mutants] }).pipe(Effect.mapError(crashedFrom)),
})

type CheckerWireEncoded = typeof Plugin.CheckerRequest.Encoded

type CheckerMutantEncoded = CheckerWireEncoded['mutants'][number]

const identityEncoded: CheckerMutantEncoded = {
  id: 'mutant-1',
  fileName: 'src/core.ts',
  mutatorName: 'ArithmeticOperator',
  replacement: '-',
  location: { start: { line: 10, column: 5 }, end: { line: 10, column: 6 } },
}

const encodedRequestOf = (mutants: ReadonlyArray<CheckerMutantEncoded>): CheckerWireEncoded => ({
  checkerName: 'test-checker',
  mutants,
})

const invalidRequest: CheckerWireEncoded = encodedRequestOf([{ ...identityEncoded, id: '' }])

const describedFields = { ...identityEncoded, _tag: 'Mutant' }

const describedMutant = (): Mutant.Mutant =>
  Effect.runSync(S.decodeEffect(Mutant.MutantFromUnknown)(describedFields).pipe(Effect.orDie))

const undescribableFields = { ...structuredClone(describedFields), mutatorName: 0 }

const undescribableMutant = (): Mutant.Mutant =>
  Result.match(S.decodeResult(Mutant.MutantFromUnknown)(undescribableFields), {
    onFailure: () => describedMutant(),
    onSuccess: () => {
      throw new Error('planned mutant was unexpectedly accepted')
    },
const planOf = (mutant: Mutant.Mutant): Mutant.MutantRunPlan => ({
  plan: 'Run',
  runOptions: {
    timeout: 1000,
    disableBail: false,
    activeMutant: mutant,
    sandboxFileName: 'sandbox.js',
    mutantActivation: 'static',
    reloadEnvironment: false,
  },
  netTime: 1,
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
            const mutant: Checker.CheckerMutantWire = {
              id: Mutant.MutantId.make('mutant-1'),
              fileName: Mutant.CanonicalFileName.make('src/core.ts'),
              mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
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

    scenario(
      'A mutant with no identifier is refused before the worker is asked',
      Gherkin.Do.pipe(
        Given('a worker process ready to verify code mutations')('harness', makeHarness),
        When('the runner submits a mutant whose identifier is empty')(
          'outcome',
          (s) =>
            S.decodeEffect(Plugin.CheckerRequest)(invalidRequest).pipe(
              Effect.flatMap((request) => s.harness.client.check(request)),
              Effect.exit,
            ),
        ),
        Then('the request is refused and the worker is never asked')((s) =>
          Effect.gen(function*() {
            expect(Exit.isFailure(s.outcome)).toBe(true)
            expect(yield* Ref.get(s.harness.receivedRef)).toHaveLength(0)
          })
        ),
      ),
    )

    scenario(
      'A mutant the checker cannot be told about is reported instead of stopping the run',
      Gherkin.Do.pipe(
        Given('a worker process ready to verify code mutations')('harness', makeHarness),
        When('the runner verifies one mutant it can describe beside one it cannot')(
          'outcome',
          (s) =>
            StrykerChecker.checkGroupedPlans(
              serviceFrom(s.harness.client),
              'test-checker',
              [planOf(describedMutant()), planOf(undescribableMutant())],
            ),
        ),
        Then('the mutant it cannot describe is reported as a compile error and is not sent to the worker')((s) =>
          Effect.gen(function*() {
            const statusOf = (id: string) =>
              s.outcome.find(([plan]) => plan.mutant.id === id)?.[1].status
            expect(s.outcome).toHaveLength(2)
            expect(statusOf('')).toBe('compileError')
            expect(statusOf('mutant-1')).toBe('passed')
            const received = yield* Ref.get(s.harness.receivedRef)
            expect(received.map((mutant) => mutant.id)).toEqual(['mutant-1'])
          })
        ),
      ),
    )
  })
