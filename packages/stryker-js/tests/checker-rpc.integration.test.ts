import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Checker as CheckerCapability, Worker } from '@systemfsoftware/stryker-js'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Checker, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Metric from 'effect/Metric'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as S from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'
import * as SocketServer from 'effect/socket/SocketServer'

import { memorySocketPair, singleConnection } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it })

const FAKE_DIGEST = Checker.ProgramDigest.make('0123456789abcdef'.repeat(4))

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
          Ref.set(receivedRef, mutants).pipe(
            Effect.map(() =>
              Object.fromEntries(
                mutants.map((m) => [m.id, { status: 'passed' as const }]),
              )
            ),
          ),
        group: ({ mutants }) => Effect.succeed([mutants.map((m) => m.id)]),
        digest: () => Effect.succeed(FAKE_DIGEST),
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

    return { client, receivedRef } satisfies CheckerHarness
  })

type CheckerWireEncoded = typeof Plugin.CheckerRequest.Encoded

type CheckerMutantEncoded = CheckerWireEncoded['mutants'][number]

const identityEncoded: CheckerMutantEncoded = {
  id: '0000000000000001',
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

const CHECKER_NAME = 'test-checker'

const MUTATOR_NAME_REFUSAL =
  'Expected a PascalCase mutator name, optionally prefixed by a lowercase kebab-case namespace and a slash\n  at ["mutatorName"]'

const runPlanOf = (mutant: Mutant.Mutant): Mutant.MutantRunPlan => ({
  plan: 'Run',
  mutant,
  netTime: 0,
  runOptions: {
    timeout: 0,
    disableBail: false,
    activeMutant: mutant,
    sandboxFileName: mutant.fileName,
    mutantActivation: 'runtime',
    reloadEnvironment: false,
  },
})

const describablePlanOf = (id: string): Mutant.MutantRunPlan =>
  runPlanOf(Mutant.Mutant.make({
    id: Mutant.MutantId.make(id),
    fileName: Mutant.CanonicalFileName.make(`src/${id}.ts`),
    mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
    replacement: '-',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }))

const lowercaseMutatorPlanOf = (id: string): Mutant.MutantRunPlan =>
  runPlanOf(Mutant.Mutant.make({
    id: Mutant.MutantId.make(id),
    fileName: Mutant.CanonicalFileName.make(`src/${id}.ts`),
    mutatorName: Mutant.MutatorName.make('lowercase', { disableChecks: true }),
    replacement: '-',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }, { disableChecks: true }))

const MIXED_PLANS = [
  describablePlanOf('0000000000000001'),
  lowercaseMutatorPlanOf('0000000000000002'),
  describablePlanOf('0000000000000003'),
]

const DESCRIBABLE_PLANS = [describablePlanOf('0000000000000001'), describablePlanOf('0000000000000003')]

const instrumentedChecker = (
  groupsOf: (ids: readonly string[]) => readonly (readonly string[])[],
): CheckerCapability.CheckerResourceService => ({
  group: (_checkerName, mutants) => Effect.succeed(groupsOf(mutants.map((mutant) => mutant.id))),
  check: (_checkerName, mutants) =>
    Effect.succeed(
      Object.fromEntries(
        mutants.map((mutant): readonly [string, Checker.CheckResult] => [mutant.id, { status: 'passed' }]),
      ),
    ),
  digest: () => Effect.succeed(FAKE_DIGEST),
})

const oneGroup = (ids: readonly string[]): readonly (readonly string[])[] => [ids]

const dropLastId = (ids: readonly string[]): readonly (readonly string[])[] => [ids.slice(0, -1)]

const checkGrouped = (checker: CheckerCapability.CheckerResourceService, plans: readonly Mutant.RunPlan[]) =>
  Effect.gen(function*() {
    const warnings: Array<string> = []
    const outcome = yield* CheckerCapability.checkGroupedCell.run({ checker, checkerName: CHECKER_NAME, plans }).pipe(
      Effect.result,
      Effect.provide(Logger.layer([
        Logger.make((entry) => {
          if (entry.logLevel === 'Warn') warnings.push([entry.message].flat().map(String).join(' '))
        }),
      ])),
    )
    const skipped = (yield* Metric.snapshot).find((snapshot) => snapshot.id === 'stryker.checker.mutants.skipped')
    return {
      checked: Result.match(outcome, {
        onFailure: (error) => ({ failed: error._tag }),
        onSuccess: (pairs) => ({
          pairs: pairs.map(([plan, result]) => ({ id: plan.mutant.id, ...result })),
        }),
      }),
      warnings,
      skippedCount: skipped?.type === 'Counter' ? Number(skipped.state.count) : 0,
    }
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))

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
              id: Mutant.MutantId.make('0000000000000001'),
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
        Then(
          'the checker passes the mutant without schema or communication errors, and the worker receives the exact mutation coordinates and text',
        )((s, expect) =>
          Effect.gen(function*() {
            const received = yield* Ref.get(s.harness.receivedRef)
            return {
              status: s.response['0000000000000001']?.status,
              receivedCount: received.length,
              received: received.map((mutant) => ({
                id: mutant.id,
                fileName: mutant.fileName,
                replacement: mutant.replacement,
                location: mutant.location,
              })),
            }
          }).pipe(Effect.map((facts) =>
            expect(facts).toEqual({
              status: 'passed',
              receivedCount: 1,
              received: [
                {
                  id: '0000000000000001',
                  fileName: 'src/core.ts',
                  replacement: '-',
                  location: { start: { line: 10, column: 5 }, end: { line: 10, column: 6 } },
                },
              ],
            })
          ))
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
        Then('the request is refused and the worker is never asked')((s, expect) =>
          Effect.gen(function*() {
            const received = yield* Ref.get(s.harness.receivedRef)
            return { refused: Exit.isFailure(s.outcome), receivedCount: received.length }
          }).pipe(Effect.map((facts) => expect(facts).toEqual({ refused: true, receivedCount: 0 })))
        ),
      ),
    )

    scenario(
      'A grouped check answers every plan, refuses an undescribable mutant once, and fails a breached group',
      Gherkin.Do.pipe(
        Given('plans for two describable mutants and one whose mutator name cannot be described')(
          'plans',
          () => Effect.succeed(MIXED_PLANS),
        ),
        When('a checker groups them faithfully, then a checker drops one requested mutant from its groups')(
          'runs',
          (s) =>
            Effect.all({
              faithful: checkGrouped(instrumentedChecker(oneGroup), s.plans),
              breached: checkGrouped(instrumentedChecker(dropLastId), s.plans),
            }),
        ),
        Then(
          'the faithful run answers the undescribable mutant as a compile error, warns once and counts one skip, and the breached run fails',
        )((s, expect) =>
          Effect.sync(() =>
            expect(s.runs).toEqual({
              faithful: {
                checked: {
                  pairs: [
                    { id: '0000000000000002', status: 'compileError', reason: MUTATOR_NAME_REFUSAL },
                    { id: '0000000000000001', status: 'passed' },
                    { id: '0000000000000003', status: 'passed' },
                  ],
                },
                warnings: [
                  `Checker "${CHECKER_NAME}" skipped 1 mutant(s) it cannot be told about: ${MUTATOR_NAME_REFUSAL} (0000000000000002)`,
                ],
                skippedCount: 1,
              },
              breached: {
                checked: { failed: 'CheckerSkippedRequested' },
                warnings: [],
                skippedCount: 0,
              },
            })
          )
        ),
      ),
    )

    scenario(
      'A grouped check over describable mutants neither warns nor counts a skip',
      Gherkin.Do.pipe(
        Given('plans whose mutants can all be described')('plans', () => Effect.succeed(DESCRIBABLE_PLANS)),
        When('a checker groups and checks them')(
          'run',
          (s) => checkGrouped(instrumentedChecker(oneGroup), s.plans),
        ),
        Then('every plan passes, nothing is logged as a warning, and the skip counter never moves')((s, expect) =>
          Effect.sync(() =>
            expect(s.run).toEqual({
              checked: {
                pairs: [
                  { id: '0000000000000001', status: 'passed' },
                  { id: '0000000000000003', status: 'passed' },
                ],
              },
              warnings: [],
              skippedCount: 0,
            })
          )
        ),
      ),
    )
  })
