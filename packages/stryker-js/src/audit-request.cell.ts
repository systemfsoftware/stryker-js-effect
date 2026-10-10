import { Cell } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import type * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { auditDrops, AuditDropsCommand } from './audit-drops.workflow.js'
import {
  type AuditedDrop,
  type AuditedPair,
  AuditFailed,
  AuditInputUnusable,
  type AuditReport,
  AuditReportJson,
  type AuditScope,
  CountedReportJson,
  type CountsReport,
  type DropAuditReport,
  type KillMatrixReport,
  KillMatrixReportJson,
  type MatrixProject,
  type NothingCounted,
  type RunCounts,
} from './audit.schema.js'
import { countRuns, CountRunsCommand } from './count-runs.workflow.js'
import { readProjectCell } from './read-project.cell.js'
import type { HostServices } from './run/host.service.js'
import { instrumentSources } from './run/instrument.js'
import { loadConfigCell } from './run/load-config.cell.js'
import { prepareForInstrumentCell } from './run/plan-prepare.cell.js'
import type { PrepareForInstrument } from './run/prepare.js'
import { RunEnvironment } from './run/RunEnvironment.service.js'
import type { EnginePorts } from './run/StageServices.service.js'

export interface AuditRequest {
  readonly matrix: string
  readonly out: string
  readonly countsOnly: boolean
  readonly projects?: ReadonlyArray<string> | undefined
  readonly files?: ReadonlyArray<string> | undefined
}

export interface AuditRequestInput {
  readonly request: AuditRequest
  readonly channel: AuditChannel
}

export interface AuditChannel {
  readonly environment: {
    readonly basePath: string
    readonly host: HostServices
    readonly console: Console.Console
  }
}

const REPORT_FILE = 'stryker-incremental.json'
const DETAIL_LINES = 20
const DECODE_DETAIL_CHARS = 300

const UNREADABLE_NEXT =
  'Pass --matrix the directory holding <project>/stryker-incremental.json for every --projects entry, such as a downloaded kill-matrix or mutation-report artifact.'
const UNDECODABLE_NEXT =
  'Audit drops against a report written by a kill-matrix run (STRYKER_KILL_MATRIX=1), which records every killer and the test catalog.'
const FILES_WITH_COUNTS_NEXT = 'Drop --files: --counts-only counts every record of the reports.'

type AuditFailure = AuditFailed | AuditInputUnusable | NothingCounted

const prepareStageCell = Cell.andThen(Cell.andThen(loadConfigCell, readProjectCell), prepareForInstrumentCell)

const readReport = <A>(
  schema: S.Codec<A, string>,
  file: string,
): Effect.Effect<A, AuditInputUnusable, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(file).pipe(
      Effect.mapError(() =>
        AuditInputUnusable.make({ code: 'matrix-unreadable', detail: `cannot read ${file}`, next: UNREADABLE_NEXT })
      ),
      Effect.flatMap((text) =>
        Effect.fromResult(Result.mapError(
          S.decodeResult(schema)(text),
          (error) =>
            AuditInputUnusable.make({
              code: 'matrix-undecodable',
              detail: `cannot decode ${file}: ${error.message.replace(/\s+/gu, ' ').slice(0, DECODE_DETAIL_CHARS)}`,
              next: UNDECODABLE_NEXT,
            }),
        ))
      ),
    ))

const projectsOf = (projects: ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  Option.getOrElse(Option.filter(Option.fromUndefinedOr(projects), Arr.isReadonlyArrayNonEmpty), () => ['.'])

const scopeOf = (path: Path.Path, basePath: string, files: ReadonlyArray<string> | undefined): AuditScope =>
  Option.match(Option.filter(Option.fromUndefinedOr(files), Arr.isReadonlyArrayNonEmpty), {
    onNone: (): AuditScope => ({ _tag: 'Corpus' }),
    onSome: (present): AuditScope => ({
      _tag: 'Files',
      files: Arr.map(present, (file) => path.relative(basePath, path.resolve(basePath, file))),
    }),
  })

const inScope = (scope: AuditScope, path: Path.Path, project: string, key: string): boolean =>
  Match.value(scope).pipe(
    Match.tag('Corpus', () => true),
    Match.tag('Files', ({ files }) => files.includes(path.join(project, key))),
    Match.exhaustive,
  )

const withDefaultPolicy = (prepared: PrepareForInstrument): PrepareForInstrument => ({
  ...prepared,
  options: { ...prepared.options, mutator: { ...prepared.options.mutator, mutantSetPolicy: 'default' } },
})

const dropOf = (project: string, mutant: Mutant.Mutant): ReadonlyArray<AuditedDrop> =>
  Option.match(Option.filter(Option.fromUndefinedOr(mutant.subsumption), S.is(Mutant.Subsumed)), {
    onNone: () => [],
    onSome: (subsumed) => [{ project, mutant: mutant.id, subsumed }],
  })

const matrixProjectOf = (project: string, report: KillMatrixReport): MatrixProject => ({
  project,
  mutants: Object.values(report.files).flatMap((file) =>
    file.mutants.map((mutant) => ({ id: mutant.id, status: mutant.status, killedBy: mutant.killedBy ?? [] }))
  ),
  tests: Object.values(report.testFiles).flatMap((file) => file.tests.map((test) => test.id)),
})

interface AuditedProject {
  readonly drops: ReadonlyArray<AuditedDrop>
  readonly matrix: MatrixProject
}

const auditProject = (
  request: AuditRequest,
  channel: AuditChannel,
  scope: AuditScope,
  directory: string,
): Effect.Effect<AuditedProject, AuditInputUnusable, EnginePorts> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const basePath = channel.environment.basePath
    const report = yield* readReport(
      KillMatrixReportJson,
      path.resolve(basePath, request.matrix, directory, REPORT_FILE),
    )
    const files = Object.entries(report.files)
      .filter(([key]) => inScope(scope, path, directory, key))
      .map(([key, file]) => ({ name: path.resolve(report.projectRoot, key), content: file.source, mutate: true }))
    const drops = yield* Effect.scoped(Effect.gen(function*() {
      const project = yield* fs.realPath(path.resolve(basePath, directory))
      const env = { ...channel.environment.host.env, basePath: project }
      const context = yield* Layer.build(RunEnvironment.stage(env, channel.environment.host.events))
      const prepared = yield* Cell.provideContext(prepareStageCell, context).run({
        cliOptions: {},
        targetMutatePatterns: undefined,
      })
      const instrumented = yield* instrumentSources(withDefaultPolicy(prepared), files)
      return instrumented.mutants.flatMap((mutant) => dropOf(directory, mutant))
    })).pipe(Effect.orDie)
    return { drops, matrix: matrixProjectOf(directory, report) }
  })

const inProjectDirectory = <A, E, R>(directory: string, body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const previous = globalThis.process.cwd()
    return Effect.acquireUseRelease(
      Effect.sync(() => globalThis.process.chdir(directory)),
      () => body,
      () => Effect.sync(() => globalThis.process.chdir(previous)),
    )
  })

const writeReport = (
  basePath: string,
  out: string,
  report: AuditReport,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.resolve(basePath, out)
    const text = yield* S.encodeEffect(AuditReportJson)(report)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, `${text}\n`)
    return target
  }).pipe(Effect.orDie)

const verdictLabel = (verdict: DropAuditReport['pairs'][number]): string =>
  Match.valueTags(verdict, {
    UnjoinablePair: (unjoinable) => `Unjoinable ${unjoinable.reason}`,
    JoinedPair: (joined) =>
      Match.valueTags(joined.verdict, {
        Pass: (pass) => `Pass ${pass.reason}`,
        Vacuous: (vacuous) => `Vacuous ${vacuous.reason}`,
        AttributionUnverified: (unverified) => `AttributionUnverified ${unverified.reason}`,
        Fail: (fail) => `Fail ${fail.reason}`,
      }),
  })

const pairLine = (pair: AuditedPair): string =>
  `${verdictLabel(pair)}: ${pair.mutant} dropped for ${pair.dominator} (${pair.project})`

const listedRankOf = (pair: AuditedPair): Option.Option<number> =>
  Match.value(pair).pipe(
    Match.tag('UnjoinablePair', () => Option.some(1)),
    Match.tag('JoinedPair', (joined) =>
      Match.value(joined.verdict).pipe(
        Match.tag('Fail', () => Option.some(0)),
        Match.tag('AttributionUnverified', () => Option.some(2)),
        Match.tag('Pass', () => Option.none()),
        Match.tag('Vacuous', () => Option.none()),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const detailLinesOf = (report: DropAuditReport): ReadonlyArray<string> => {
  const ranked = report.pairs.flatMap((pair) =>
    Option.toArray(Option.map(listedRankOf(pair), (rank) => ({ rank, pair })))
  )
  const failing = ranked.filter((entry) => entry.rank === 0).map((entry) => pairLine(entry.pair))
  const orphans = report.orphanedTests.map((orphan) =>
    `Orphaned ${orphan.reason}: test ${orphan.test} (${orphan.project}) kills only ${orphan.killed.length} dropped mutant(s)`
  )
  const rest = ranked.filter((entry) => entry.rank > 0).toSorted((a, b) => a.rank - b.rank).map((entry) =>
    pairLine(entry.pair)
  )
  return [...failing, ...orphans, ...rest]
}

const attestation = (rule: DropAuditReport['rules'][number]): string =>
  Match.valueTags(rule, { Attested: () => 'Attested', Unattested: (unattested) => `Unattested (${unattested.reason})` })

const ruleLine = (rule: DropAuditReport['rules'][number]): string =>
  `rule ${rule.rule}: ${rule.drops} drop(s); ${rule.pass} Pass, ${rule.vacuous} Vacuous, ${rule.attributionUnverified} AttributionUnverified, ${rule.fail} Fail, ${rule.unjoinable} Unjoinable; ${
    attestation(rule)
  }`

const outcomeLabel = (report: DropAuditReport): string =>
  Match.valueTags(report, { DropAuditPassed: () => 'passed', DropAuditFailed: () => 'FAILED' })

const truncatedOf = (details: ReadonlyArray<string>): ReadonlyArray<string> =>
  Boolean.match(details.length > DETAIL_LINES, {
    onTrue: () => [...details.slice(0, DETAIL_LINES), `... ${details.length - DETAIL_LINES} more`],
    onFalse: () => details,
  })

const dropSummaryOf = (report: DropAuditReport, target: string): ReadonlyArray<string> => {
  const drops = report.projects.reduce((sum, project) => sum + project.drops, 0)
  return [
    `stryker audit: ${
      outcomeLabel(report)
    }, ${drops} drop(s) over ${report.projects.length} project(s), ${report.pairs.length} pair(s)`,
    ...report.rules.map(ruleLine),
    ...truncatedOf(detailLinesOf(report)),
    `report: ${target}`,
  ]
}

const countsLine = (label: string, counts: RunCounts): string =>
  `${label}: ${counts.planned} planned, ${counts.statuses.CompileError} CompileError (${
    (counts.compileErrorShare * 100).toFixed(1)
  }%), ${counts.compiled} compiled, ${counts.executed} executed, ${counts.testExecutions} test executions`

const countsSummaryOf = (report: CountsReport, target: string): ReadonlyArray<string> => [
  ...report.projects.map((project) => countsLine(project.project, project.counts)),
  countsLine('total', report.total),
  `report: ${target}`,
]

const printAll = (channel: AuditChannel, lines: ReadonlyArray<string>): Effect.Effect<void> =>
  Effect.sync(() => lines.forEach((line) => channel.environment.console.log(line)))

const auditDropList = (
  request: AuditRequest,
  channel: AuditChannel,
): Effect.Effect<void, AuditFailure, EnginePorts> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const basePath = channel.environment.basePath
    const scope = scopeOf(path, basePath, request.files)
    const audited = yield* Effect.forEach(
      projectsOf(request.projects),
      (directory) => inProjectDirectory(directory, auditProject(request, channel, scope, directory)),
      { concurrency: 1 },
    )
    const report = yield* Effect.fromResult(auditDrops(AuditDropsCommand.make({
      scope,
      drops: audited.flatMap((project) => project.drops),
      matrix: audited.map((project) => project.matrix),
    })))
    const target = yield* writeReport(basePath, request.out, report)
    yield* printAll(channel, dropSummaryOf(report, target))
    yield* Match.valueTags(report, {
      DropAuditPassed: () => Effect.void,
      DropAuditFailed: (failed) => Effect.fail(AuditFailed.make({ failures: failed.failures, report: target })),
    })
  })

const countReports = (
  request: AuditRequest,
  channel: AuditChannel,
): Effect.Effect<void, AuditFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const basePath = channel.environment.basePath
    yield* Effect.when(
      Effect.fail(AuditInputUnusable.make({
        code: 'files-with-counts-only',
        detail: '--files scopes the drop audit, which --counts-only does not run',
        next: FILES_WITH_COUNTS_NEXT,
      })),
      Effect.succeed(Option.isSome(Option.filter(Option.fromUndefinedOr(request.files), Arr.isReadonlyArrayNonEmpty))),
    )
    const reports = yield* Effect.forEach(projectsOf(request.projects), (project) =>
      Effect.map(
        readReport(CountedReportJson, path.resolve(basePath, request.matrix, project, REPORT_FILE)),
        (report) => ({ project, report }),
      ))
    const counts = yield* Effect.fromResult(countRuns(CountRunsCommand.make({ reports })))
    const target = yield* writeReport(basePath, request.out, counts)
    yield* printAll(channel, countsSummaryOf(counts, target))
  })

export const auditRequest = ({ request, channel }: AuditRequestInput): Effect.Effect<void, AuditFailure, EnginePorts> =>
  Boolean.match(request.countsOnly, {
    onTrue: () => countReports(request, channel),
    onFalse: () => auditDropList(request, channel),
  })
