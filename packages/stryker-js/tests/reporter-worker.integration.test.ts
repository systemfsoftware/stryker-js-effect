import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  calculateMetrics,
  REPORTER_EVENT_BATCH_BOUND,
  reporterWorkerFactory,
  spawnReporterWorker,
} from '@systemfsoftware/stryker-js'
import type { WorkerSpawnParams } from '@systemfsoftware/stryker-js'
import type { MutationTestResult, ReporterEvent } from '@systemfsoftware/stryker-js-plugin-interface'
import { MutationTestReportReady, StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { DryRunCompleted, MutantTested, MutationTestingPlanReady } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterInitOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { decodeWorkerOptions } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

import {
  makeReporterWorkerTrace,
  REPORTER_WORKER_ENTRYPOINT,
  reporterServingLauncher,
  type ReporterWorkerGauge,
  type ReporterWorkerTrace,
} from './__fixtures__/substituted-reporter-worker.fixture.js'

const Feature = makeFeature({ it, layer })

const PROJECT_BASE_PATH = '/project'
const MARKER_FILE = 'src/marker.ts'
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const LARGE_RUN = REPORTER_EVENT_BATCH_BOUND * 3 + 7

const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } }

const markerReport = (): MutationTestResult => ({
  schemaVersion: '1.0',
  files: {
    [MARKER_FILE]: {
      language: 'typescript',
      source: 'export const marker = true',
      mutants: [
        {
          id: '0',
          mutatorName: 'BooleanLiteral',
          replacement: 'false',
          status: 'Killed',
          location,
          coveredBy: ['0'],
          killedBy: ['0'],
        },
      ],
    },
  },
  thresholds: { high: 80, low: 60 },
})

const metricsFixture = (report: MutationTestResult) => calculateMetrics(report.files)

const killedMutant = (index: number, total: number): MutantTested =>
  MutantTested.make({
    id: String(index),
    status: 'Killed',
    file: MARKER_FILE,
    location,
    mutator: 'BooleanLiteral',
    replacement: null,
    completed: index,
    total,
  })

const completedRun = (): readonly ReporterEvent[] => {
  const report = markerReport()
  return [
    DryRunCompleted.make({
      timing: { net: 1, overhead: 0 },
      capabilities: { reloadEnvironment: false },
      testCount: 1,
      tests: [],
    }),
    MutationTestingPlanReady.make({
      total: 1,
      plans: [{ mutantId: '0', plan: 'Run', netTime: 1, reloadEnvironment: false }],
    }),
    killedMutant(1, 1),
    MutationTestReportReady.make({ report, metrics: metricsFixture(report) }),
  ]
}

const largeRun = (gauge: ReporterWorkerGauge, total: number): AsyncIterable<ReporterEvent> => ({
  [Symbol.asyncIterator]: () => {
    let index = 0
    return {
      next: (..._args: [] | [unknown]): Promise<IteratorResult<ReporterEvent>> => {
        if (index >= total) return Promise.resolve({ done: true, value: undefined })
        Effect.runSync(
          Effect.gen(function*() {
            const yielded = yield* Ref.updateAndGet(gauge.yielded, (produced) => produced + 1)
            const delivered = yield* Ref.get(gauge.delivered)
            yield* Ref.update(gauge.maxLag, (largest) => Math.max(largest, yielded - delivered))
          }),
        )
        const value = killedMutant(index + 1, total)
        index += 1
        return Promise.resolve({ done: false, value })
      },
    }
  },
})

function asStream(events: AsyncIterable<ReporterEvent>): AsyncIterable<ReporterEvent> {
  return events
}

const ofEvents = (events: readonly ReporterEvent[]): AsyncIterable<ReporterEvent> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = events[Symbol.iterator]()
    return {
      next: (...args: [] | [unknown]) => Promise.resolve(iterator.next(...args)),
    }
  },
})

const spawnOf = (spawns: readonly WorkerSpawnParams[]): WorkerSpawnParams => {
  const first = spawns[0]
  if (first === undefined) {
    throw new Error('the reporter worker was never started')
  }
  return first
}

const tagOf = (event: ReporterEvent): string =>
  Match.value(event).pipe(
    Match.tag('dryRunCompleted', () => 'dryRunCompleted'),
    Match.tag('mutationTestingPlanReady', () => 'mutationTestingPlanReady'),
    Match.tag('mutantTested', () => 'mutantTested'),
    Match.tag('mutationTestReportReady', () => 'mutationTestReportReady'),
    Match.exhaustive,
  )

const tagsOf = (events: readonly ReporterEvent[]): readonly string[] => events.map(tagOf)

interface ObservedRun {
  readonly delivered: readonly ReporterEvent[]
  readonly deliverySizes: readonly number[]
  readonly inits: readonly ReporterInitOptions[]
  readonly flushes: number
  readonly spawns: readonly WorkerSpawnParams[]
  readonly maxLag: number
  readonly yielded: number
}

interface ReporterPluginTarget {
  readonly entrypoint: string
  readonly projectBasePath: string
}

const REPORTER_PLUGIN: ReporterPluginTarget = {
  entrypoint: REPORTER_WORKER_ENTRYPOINT,
  projectBasePath: PROJECT_BASE_PATH,
}

const driveReporterWorker = (
  target: ReporterPluginTarget,
  produce: (gauge: ReporterWorkerGauge, trace: ReporterWorkerTrace) => AsyncIterable<ReporterEvent>,
): Effect.Effect<ObservedRun> =>
  Effect.scoped(
    Effect.gen(function*() {
      const options = yield* S.decodeUnknownEffect(StrykerOptionsSchema)({})
      const trace = yield* makeReporterWorkerTrace
      const launcher = yield* reporterServingLauncher(trace)
      const client = yield* spawnReporterWorker({
        entrypoint: target.entrypoint,
        projectBasePath: target.projectBasePath,
        execArgv: [],
        options,
        tempDirPrefix: 'stryker-reporter-',
      }).pipe(Effect.provide(launcher.layer))

      yield* reporterWorkerFactory(client)(options, { traceparent: TRACEPARENT })(
        asStream(produce(trace.gauge, trace)),
      )

      const batches = yield* Ref.get(trace.batches)
      return {
        delivered: batches.flat(),
        deliverySizes: batches.map((batch) => batch.length),
        inits: yield* Ref.get(trace.inits),
        flushes: yield* Ref.get(trace.flushes),
        spawns: yield* Ref.get(launcher.spawns),
        maxLag: yield* Ref.get(trace.gauge.maxLag),
        yielded: yield* Ref.get(trace.gauge.yielded),
      }
    }),
  ).pipe(Effect.orDie)

Feature('Reporting a mutation run through a reporter plugin process').body(({ scenario }) => {
  scenario(
    'A completed run reaches the reporter process and is drained',
    Gherkin.Do.pipe(
      Given('a reporter plugin whose own process is ready to serve')('plugin', () => Effect.succeed(REPORTER_PLUGIN)),
      When('the host reports the completed run to it')(
        'driven',
        (s) => driveReporterWorker(s.plugin, () => ofEvents(completedRun())),
      ),
      Then('the process receives the whole run in order')((s) => {
        expect(tagsOf(s.driven.delivered)).toStrictEqual(tagsOf(completedRun()))
        expect(s.driven.deliverySizes).toStrictEqual([completedRun().length])
      }),
      Then('the process is initialised with the run trace and drained once')((s) => {
        expect(s.driven.inits).toStrictEqual([{ traceparent: TRACEPARENT }])
        expect(s.driven.flushes).toBe(1)
      }),
      Then('the process is started in the project being reported')((s) =>
        Effect.gen(function*() {
          const spawn = spawnOf(s.driven.spawns)
          expect(spawn.workingDirectory).toBe(PROJECT_BASE_PATH)
          expect(spawn.entrypoint).toBe(REPORTER_WORKER_ENTRYPOINT)
          const options = yield* decodeWorkerOptions(spawn.optionsJson)
          expect(options.htmlReporter.fileName).toBe('reports/mutation/mutation.html')
        })
      ),
    ),
  )

  scenario(
    'A fast run cannot outrun the reporter process',
    Gherkin.Do.pipe(
      Given(
        'a reporter plugin whose own process is ready to serve, and a run producing far more events than one delivery',
      )(
        'plan',
        () => Effect.succeed({ target: REPORTER_PLUGIN, total: LARGE_RUN }),
      ),
      When('the host reports that run to it')(
        'driven',
        (s) => driveReporterWorker(s.plan.target, (gauge) => largeRun(gauge, s.plan.total)),
      ),
      Then('every event of the run arrives')((s) => {
        expect(s.driven.yielded).toBe(LARGE_RUN)
        expect(s.driven.delivered.length).toBe(LARGE_RUN)
        expect(s.driven.deliverySizes).toStrictEqual([
          REPORTER_EVENT_BATCH_BOUND,
          REPORTER_EVENT_BATCH_BOUND,
          REPORTER_EVENT_BATCH_BOUND,
          LARGE_RUN - 3 * REPORTER_EVENT_BATCH_BOUND,
        ])
      }),
      Then('the producer stays at most one delivery ahead of the process')((s) => {
        expect(s.driven.maxLag).toBeGreaterThan(0)
        expect(s.driven.maxLag).toBeLessThanOrEqual(REPORTER_EVENT_BATCH_BOUND)
      }),
    ),
  )
})
