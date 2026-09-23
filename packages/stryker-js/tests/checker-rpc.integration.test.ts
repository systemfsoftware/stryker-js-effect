import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  checkerMutantsSkipped,
  type CheckerResourceService,
  CheckerRpcs,
  checkGroupedPlans,
  ChildProcessCrashedError,
  makeWorkerClient,
  WorkerLauncher,
} from '@systemfsoftware/stryker-js'
import { Mutant, type MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter'
import { type CheckerMutantWire, StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { layerTraceContextServer } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
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
        Effect.succeed({
          pid: 4242,
          clientLayer: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, clientSocket)),
            Layer.provide(RpcSerialization.layerNdjson),
          ),
          exited: Effect.never,
        }),
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

const crashedFrom = (error: { readonly message: string }): ChildProcessCrashedError =>
  ChildProcessCrashedError.make({ pid: 0, exit: { _tag: 'Code', code: 1 }, cause: error.message })

const serviceFrom = (
  client: RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>,
): CheckerResourceService => ({
  check: (checkerName, mutants) =>
    client.check({ checkerName, mutants: [...mutants] }).pipe(Effect.mapError(crashedFrom)),
  group: (checkerName, mutants) =>
    client.group({ checkerName, mutants: [...mutants] }).pipe(Effect.mapError(crashedFrom)),
})

const identityFields = {
  fileName: 'src/core.ts',
  mutatorName: 'ArithmeticOperator',
  replacement: '-',
  location: { start: { line: 10, column: 5 }, end: { line: 10, column: 6 } },
} as const

const planOf = (mutant: Mutant): MutantRunPlan => ({
  plan: 'Run',
  mutant,
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

const describedMutant = (): Mutant => Mutant.make({ ...identityFields, id: 'mutant-1' })
const undescribableMutant = (): Mutant => ({ ...identityFields, _tag: 'Mutant', id: '' })

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
              id: 'mutant-1',
              fileName: 'src/core.ts',
              mutatorName: 'ArithmeticOperator',
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
            s.harness.client
              .check({
                checkerName: 'test-checker',
                mutants: [
                  {
                    id: '',
                    fileName: 'src/core.ts',
                    mutatorName: 'ArithmeticOperator',
                    replacement: '-',
                    location: {
                      start: { line: 10, column: 5 },
                      end: { line: 10, column: 6 },
                    },
                  },
                ],
              })
              .pipe(Effect.exit),
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
        When('the runner verifies one describable mutant beside one it cannot describe')(
          'outcome',
          (s) =>
            Effect.gen(function*() {
              const skippedBefore = yield* Metric.value(checkerMutantsSkipped)
              const checked = yield* checkGroupedPlans(
                serviceFrom(s.harness.client),
                'test-checker',
                [planOf(describedMutant()), planOf(undescribableMutant())],
              )
              const skippedAfter = yield* Metric.value(checkerMutantsSkipped)
              return { checked, skippedBefore, skippedAfter }
            }),
        ),
        Then('the undescribable mutant is answered as a compile error and never reaches the worker')(
          (s) =>
            Effect.gen(function*() {
              const statusById = HashMap.fromIterable(
                s.outcome.checked.map(([plan, result]): readonly [string, string] => [
                  plan.mutant.id,
                  result.status,
                ]),
              )
              expect(s.outcome.checked).toHaveLength(2)
              expect(HashMap.get(statusById, '')).toEqual(Option.some('compileError'))
              expect(HashMap.get(statusById, 'mutant-1')).toEqual(Option.some('passed'))
              expect(s.outcome.skippedAfter.count).toBeGreaterThan(s.outcome.skippedBefore.count)
              const received = yield* Ref.get(s.harness.receivedRef)
              expect(received.map((mutant) => mutant.id)).toEqual(['mutant-1'])
            }),
        ),
      ),
    )
  })
