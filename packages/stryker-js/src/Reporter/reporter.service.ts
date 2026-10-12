import { Cell } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options, Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { clearTextReportCell } from './clear-text-report.cell.js'
import { jsonReportCell } from './json-report.cell.js'
import { progressReportCell } from './progress-report.cell.js'
import { JsonReporterName } from './render-json-report.workflow.js'
import { ProgressReporterName, type ProgressState } from './render-progress-report.workflow.js'
import { failAsReporter } from './reporter-failed.js'
import { ReporterOutput } from './reporter-output.service.js'
import { HumanStreamRole, MachineStreamRole } from './reporter-role.schema.js'
import { sarifReportCell } from './sarif-report.cell.js'
import { SarifReporterName } from './sarif-report.workflow.js'

export interface BuiltinReporter {
  readonly name: string
  readonly stdout: boolean
  readonly factory: InterfaceReporter.ReporterFactory
}

export interface ReporterShape {
  readonly builtin: readonly BuiltinReporter[]
}

type ReporterServices = ReporterOutput | FileSystem.FileSystem | Path.Path

interface ReportInput {
  readonly options: Options.StrykerOptions
  readonly events: AsyncIterable<InterfaceReporter.ReporterEvent>
}

const fromReportCell = <A = unknown>(
  cell: Cell.Cell<ReportInput, A, InterfaceReporter.ReporterFailed, ReporterServices>,
  context: Context.Context<ReporterServices>,
): InterfaceReporter.ReporterFactory => {
  const report = Cell.provideContext(cell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

const INITIAL_PROGRESS: ProgressState = {
  tally: {
    survived: 0,
    timedOut: 0,
    tested: 0,
    mutants: 0,
    total: 0,
    ticks: 0,
    ticksByMutantId: {},
    timing: { net: 0, overhead: 0 },
    capabilities: { reloadEnvironment: false },
    startedAt: 0,
  },
  bar: null,
}

const failAsProgress = failAsReporter(ProgressReporterName.literal)

const progressReporterFactory = (context: Context.Context<ReporterServices>): InterfaceReporter.ReporterFactory => {
  const step = Cell.provideContext(progressReportCell, context)
  const consumeEvent = Effect.fn(SpanTaxonomy.Spans.reportProgressConsumeEvent.name)(function*(
    state: Ref.Ref<ProgressState>,
    event: InterfaceReporter.ReporterEvent,
  ) {
    const current = yield* Ref.get(state)
    const next = yield* step.run({ state: current, event })
    yield* Ref.set(state, next)
  })
  return () =>
    Effect.fn(SpanTaxonomy.Spans.reportProgressConsume.name)(function*(
      events: AsyncIterable<InterfaceReporter.ReporterEvent>,
    ) {
      const state = yield* Ref.make<ProgressState>(INITIAL_PROGRESS)
      yield* Stream.runForEach(
        Stream.fromAsyncIterable(events, failAsProgress),
        (event) => consumeEvent(state, event),
      )
      yield* step.run({ state: yield* Ref.get(state), event: undefined })
    })
}

const drainReporterFactory: InterfaceReporter.ReporterFactory = () => (events) =>
  Stream.runDrain(Stream.fromAsyncIterable(events, failAsProgress))

export class Reporter extends Context.Service<Reporter, ReporterShape>()(
  '@systemfsoftware/stryker-js/Reporter/reporter.service/Reporter',
) {
  static readonly layer: Layer.Layer<Reporter, never, ReporterServices> = Layer.effect(
    Reporter,
    Effect.map(Effect.all([ReporterOutput, FileSystem.FileSystem, Path.Path]), ([output, fs, path]) => {
      const context = Context.make(ReporterOutput, ReporterOutput.of({ write: output.write })).pipe(
        Context.add(FileSystem.FileSystem, fs),
        Context.add(Path.Path, path),
      )
      return Reporter.of({
        builtin: [
          { name: JsonReporterName.literal, stdout: false, factory: fromReportCell(jsonReportCell, context) },
          { name: HumanStreamRole.literal, stdout: true, factory: fromReportCell(clearTextReportCell, context) },
          { name: ProgressReporterName.literal, stdout: true, factory: progressReporterFactory(context) },
          { name: SarifReporterName.literal, stdout: false, factory: fromReportCell(sarifReportCell, context) },
          { name: MachineStreamRole.literal, stdout: false, factory: drainReporterFactory },
        ],
      })
    }),
  )
}
