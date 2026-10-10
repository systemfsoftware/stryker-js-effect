import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

import { type StoredVerdict, storedVerdictsIn } from './__fixtures__/stored-verdicts.fixture.js'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const SOURCE = [
  'export const add = (left: number, right: number): number => left + right',
  'export const label = (): string => "value"',
  '',
].join('\n')

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const writeFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie)

const removeFixture = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    filePorts,
  )

const optionsOf = (root: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
})

interface RunRead {
  readonly reused: number
  readonly streamCosts: Readonly<Record<string, number>>
}

const runOnce = (root: string): Effect.Effect<RunRead, never, never> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(Layer.provide(Engine.RunEnvironment.stage(environmentFor(root), queue), ports), ports)
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.orDie)
    const events = yield* Queue.end(queue).pipe(
      Effect.andThen(Queue.takeAll(queue)),
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    const reused = events.flatMap((event) => S.is(RunEvent.ReuseReported)(event) ? [event.reused] : []).reduce(
      (total, count) => total + count,
      0,
    )
    const streamCosts = Object.fromEntries(
      events.flatMap((event) =>
        S.is(RunEvent.RunMutantTested)(event) && event.cost !== null
          ? [[event.id, event.cost.fixedOverheadMs + event.cost.testBodyMs] as const]
          : []
      ),
    )
    return { reused, streamCosts }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

interface Observed {
  readonly first: RunRead
  readonly storedAfterFirst: Readonly<Record<string, StoredVerdict>>
  readonly storedAfterSecond: Readonly<Record<string, StoredVerdict>>
  readonly reused: number
}

const costSummaryOf = (observed: Observed) => {
  const executedIds = Object.keys(observed.first.streamCosts)
  return {
    executedSome: executedIds.length > 0,
    everyExecutedStored: executedIds.every((id) => observed.storedAfterFirst[id] !== undefined),
    storedCostIsStreamCost: executedIds.every((id) =>
      Option.contains(
        Option.map(Option.fromUndefinedOr(observed.storedAfterFirst[id]), (stored) => stored.costMs),
        observed.first.streamCosts[id],
      )
    ),
    secondReusedSome: observed.reused > 0,
    reuseLeavesEntriesUnchanged: JSON.stringify(observed.storedAfterSecond) ===
      JSON.stringify(observed.storedAfterFirst),
  }
}

Feature('Per-mutant cost record')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so report I/O is the real one')
  .body(({ scenario }) => {
    scenario(
      'A run stores each executed verdict with its measured cost, and a run that reuses those verdicts leaves them unchanged',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental run completes twice')('observed', () =>
          Effect.gen(function*() {
            const root = yield* writeFixture([['src/math.ts', SOURCE]])
            return yield* Effect.ensuring(
              Effect.gen(function*() {
                const first = yield* runOnce(root)
                const storedAfterFirst = yield* storedVerdictsIn({
                  projectRoot: root,
                  mutantIds: Object.keys(first.streamCosts),
                })
                const second = yield* runOnce(root)
                const storedAfterSecond = yield* storedVerdictsIn({
                  projectRoot: root,
                  mutantIds: Object.keys(first.streamCosts),
                })
                return { first, storedAfterFirst, storedAfterSecond, reused: second.reused }
              }),
              removeFixture(root),
            )
          }).pipe(Effect.orDie, Effect.provide(filePorts))),
        Then(
          'every executed mutant has a stored entry whose cost is the stream cost, and the reusing run rewrote none of them',
        )(
          (s, expect) =>
            expect(costSummaryOf(s.observed)).toEqual({
              executedSome: true,
              everyExecutedStored: true,
              storedCostIsStreamCost: true,
              secondReusedSome: true,
              reuseLeavesEntriesUnchanged: true,
            }),
        ),
      ),
    )
  })
