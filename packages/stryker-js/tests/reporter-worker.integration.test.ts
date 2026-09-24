import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Options, type Plugin, type Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import { expect } from 'vitest'
import { Plugin as StrykerPlugin, RunEvent, type Worker as StrykerWorker } from '../src/mod.js'

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
const LARGE_RUN = StrykerPlugin.REPORTER_EVENT_BATCH_BOUND * 3 + 7

const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } }

const markerReport = (): Report.MutationTestResult => ({
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

const metricsFixture = (report: Report.MutationTestResult) => RunEvent.MetricsResultFromReport.fromFiles(report.files)

const killedMutant = (index: number, total: number): Reporter.MutantTested =>
  Reporter.MutantTested.make({
    id: String(index),
    status: 'Killed',
    file: MARKER_FILE,
    location,
    mutator: 'BooleanLiteral',
    replacement: null,
    completed: index,
    total,
  })

const completedRun = (): readonly Reporter.ReporterEvent[] => {
  const report = markerReport()
  return [
    Reporter.DryRunCompleted.make({
      timing: { net: 1, overhead: 0 },
      capabilities: { reloadEnvironment: false },
      testCount: 1,
      tests: [],
    }),
    Reporter.MutationTestingPlanReady.make({
      total: 1,
      plans: [{ mutantId: '0', plan: 'Run', netTime: 1, reloadEnvironment: false }],
    }),
    killedMutant(1, 1),
    Reporter.MutationTestReportReady.make({ report, metrics: metricsFixture(report) }),
  ]
}

const largeRun = (gauge: ReporterWorkerGauge, total: number): AsyncIterable<Reporter.ReporterEvent> => ({
  [Symbol.asyncIterator]: () => {
    let index = 0
    return {
      next: <A = unknown>(..._args: [] | [A]): Promise<IteratorResult<Reporter.ReporterEvent>> => {
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

function asStream(events: AsyncIterable<Reporter.ReporterEvent>): AsyncIterable<Reporter.ReporterEvent> {
  return events
}

const ofEvents = (events: readonly Reporter.ReporterEvent[]): AsyncIterable<Reporter.ReporterEvent> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = events[Symbol.iterator]()
    return {
      next: <A = unknown>(...args: [] | [A]) => Promise.resolve(iterator.next(...args)),
    }
  },
})

const spawnOf = (spawns: readonly StrykerWorker.WorkerSpawnParams[]): StrykerWorker.WorkerSpawnParams => {
  const first = spawns[0]
  if (first === undefined) {
    throw new Error('the reporter worker was never started')
  }
  return first
}

const tagOf = (event: Reporter.ReporterEvent): string =>
  Match.value(event).pipe(
    Match.tag('dryRunCompleted', () => 'dryRunCompleted'),
    Match.tag('mutationTestingPlanReady', () => 'mutationTestingPlanReady'),
    Match.tag('mutantTested', () => 'mutantTested'),
    Match.tag('mutationTestReportReady', () => 'mutationTestReportReady'),
    Match.exhaustive,
  )

const tagsOf = (events: readonly Reporter.ReporterEvent[]): readonly string[] => events.map(tagOf)

interface ObservedRun {
  readonly delivered: readonly Reporter.ReporterEvent[]
  readonly deliverySizes: readonly number[]
  readonly inits: readonly Plugin.ReporterInitOptions[]
  readonly flushes: number
  readonly spawns: readonly StrykerWorker.WorkerSpawnParams[]
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
  produce: (gauge: ReporterWorkerGauge, trace: ReporterWorkerTrace) => AsyncIterable<Reporter.ReporterEvent>,
): Effect.Effect<ObservedRun> =>
  Effect.scoped(
    Effect.gen(function*() {
      const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({})
      const trace = yield* makeReporterWorkerTrace
      const launcher = yield* reporterServingLauncher(trace)
      const client = yield* StrykerPlugin.spawnReporterWorker({
        entrypoint: target.entrypoint,
        projectBasePath: target.projectBasePath,
        execArgv: [],
        options,
        tempDirPrefix: 'stryker-reporter-',
      }).pipe(Effect.provide(launcher.layer))

      yield* StrykerPlugin.reporterWorkerFactory(client)(options, { traceparent: TRACEPARENT })(
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

Feature('Reporting a mutation run through a reporter plugin process')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
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
            const options = yield* S.decodeEffect(Worker.WorkerOptionsWire)(spawn.optionsJson)
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
            StrykerPlugin.REPORTER_EVENT_BATCH_BOUND,
            StrykerPlugin.REPORTER_EVENT_BATCH_BOUND,
            StrykerPlugin.REPORTER_EVENT_BATCH_BOUND,
            LARGE_RUN - 3 * StrykerPlugin.REPORTER_EVENT_BATCH_BOUND,
          ])
        }),
        Then('the producer stays at most one delivery ahead of the process')((s) => {
          expect(s.driven.maxLag).toBeGreaterThan(0)
          expect(s.driven.maxLag).toBeLessThanOrEqual(StrykerPlugin.REPORTER_EVENT_BATCH_BOUND)
        }),
      ),
    )
  })
