import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { Options, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import type { MergeReportsRequest } from './Cli.schema.js'
import {
  DuplicatePackageLabel,
  mergeReportParts,
  MergeReportPartsCommand,
  MergeSurvivor as MergeSurvivorSchema,
  MergeVerdictRow as MergeVerdictRowSchema,
  MissingPackages,
} from './merge-report-parts.workflow.js'
import { MergeReportsFailed, PartMetaSchema } from './merge-reports.schema.js'
import type { OutputMode } from './output-mode.schema.js'
import { reportFromStream, ReportFromStreamCommand } from './report-from-stream.workflow.js'
import { MetricsResultFromReport } from './reporting/metrics-from-report.schema.js'

const PART_MARKER = 'mutation-part.json'
const PART_REPORT = 'mutation-report.json'
const PART_STREAM = 'mutation-stream.jsonl'
const OUT_REPORT = 'mutation-report.json'
const OUT_HTML = 'mutation-report.html'
const OUT_SUMMARY = 'summary.md'
const SURVIVOR_CAP = 100
const ALL_PACKAGES = '**all**'
const STEP_SUMMARY = 'GITHUB_STEP_SUMMARY'

type VerdictRow = S.Schema.Type<typeof MergeVerdictRowSchema>
type Survivor = S.Schema.Type<typeof MergeSurvivorSchema>
type MutationReport = S.Schema.Type<typeof Report.MutationTestResultSchema>

type MergeCommand = MergeReportPartsCommand & {
  readonly out: string
  readonly partsDir: string
  readonly skipped: readonly string[]
  readonly unreadable: readonly string[]
  readonly mode: OutputMode
}

type EncodedMerge = {
  readonly summary: string
  readonly report: MutationReport | undefined
  readonly unreadable: readonly string[]
}

export type MergeReportsInvocation = MergeReportsRequest & { readonly mode: OutputMode }

const refuse = (reason: string) => MergeReportsFailed.make({ reason })

const failReason = Effect.fn('stryker.merge_reports.fail')(function*(reason: string) {
  yield* Console.error(`stryker merge-reports: ${reason}`)
  return yield* MergeReportsFailed.make({ reason })
})

const readText = Effect.fn('stryker.merge_reports.read_text')(function*(file: string) {
  return yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.option,
    Effect.map(Option.getOrUndefined),
  )
})

const listNames = Effect.fn('stryker.merge_reports.list_names')(function*(dir: string) {
  return yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readDirectory(dir)),
    Effect.orElseSucceed((): readonly string[] => []),
    Effect.map((names) => [...names].sort()),
  )
})

const directoryExists = Effect.fn('stryker.merge_reports.directory_exists')(function*(full: string) {
  return yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.stat(full)),
    Effect.option,
    Effect.map((info) => Option.exists(info, (entry) => entry.type === 'Directory')),
  )
})

const collectPartDirs: (
  dir: string,
) => Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> = Effect.fn(
  'stryker.merge_reports.collect_part_dirs',
)(function*(dir: string) {
  const path = yield* Path.Path
  const names = yield* listNames(dir)
  const entries = yield* Effect.forEach(names, (name) => {
    const full = path.join(dir, name)
    return Effect.map(directoryExists(full), (isDir) => ({ dir, name, full, isDir }))
  })
  const isPartDir = entries.some((entry) => !entry.isDir && entry.name === PART_MARKER)
  const current = [dir].filter(() => isPartDir)
  const subDirs = entries.filter((entry) => entry.isDir).map((entry) => entry.full)
  const subMatches = yield* Effect.forEach(subDirs, collectPartDirs)
  return [...current, ...subMatches.flat()]
})

const readPartBytes = Effect.fn('stryker.merge_reports.read_part')(function*(dir: string) {
  const path = yield* Path.Path
  return {
    dir,
    metaText: yield* readText(path.join(dir, PART_MARKER)),
    reportText: yield* readText(path.join(dir, PART_REPORT)),
    streamText: yield* readText(path.join(dir, PART_STREAM)),
  }
})

const reportOfStreamText = (streamText: string | undefined) =>
  Option.flatMap(
    Option.fromNullishOr(streamText),
    (text) =>
      Result.match(reportFromStream(ReportFromStreamCommand.make({ text })), {
        onFailure: () => Option.none<MutationReport>(),
        onSuccess: (decision) =>
          Match.value(decision).pipe(
            Match.tag('ReportFromStreamRebuilt', (rebuilt) => Option.some(rebuilt.report)),
            Match.tag('ReportFromStreamAbsent', () => Option.none<MutationReport>()),
            Match.exhaustive,
          ),
      }),
  )

const decodedPart = (bytes: {
  readonly dir: string
  readonly metaText: string | undefined
  readonly reportText: string | undefined
  readonly streamText: string | undefined
}) =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(bytes.metaText), S.decodeOption(S.fromJsonString(PartMetaSchema))),
    {
      onNone: () => ({ part: Option.none(), unreadable: false }),
      onSome: (meta) => {
        const base = { label: meta.package, outcome: meta.outcome, incomplete: false }
        return Option.match(Option.fromNullishOr(bytes.reportText), {
          onSome: (text) =>
            Option.match(S.decodeOption(S.fromJsonString(Report.MutationTestResultSchema))(text), {
              onNone: () => ({ part: Option.some(base), unreadable: true }),
              onSome: (report) => ({ part: Option.some({ ...base, report }), unreadable: false }),
            }),
          onNone: () =>
            Option.match(reportOfStreamText(bytes.streamText), {
              onNone: () => ({ part: Option.some(base), unreadable: false }),
              onSome: (report) => ({ part: Option.some({ ...base, incomplete: true, report }), unreadable: false }),
            }),
        })
      },
    },
  )

const expectedPackages = (raw: string | undefined) =>
  Option.match(Option.filter(Option.fromNullishOr(raw), S.is(S.NonEmptyString)), {
    onNone: () => Result.succeed(undefined),
    onSome: (text) =>
      Option.match(S.decodeOption(S.String.pipe(S.Array, S.fromJsonString))(text), {
        onNone: () => Result.fail(refuse(`--packages is not a JSON array: ${text}`)),
        onSome: (packages) => Result.succeed(packages),
      }),
  })

export const decodeMerge = (raw: {
  readonly packagesRaw: string | undefined
  readonly bytes: readonly {
    readonly dir: string
    readonly metaText: string | undefined
    readonly reportText: string | undefined
    readonly streamText: string | undefined
  }[]
}) =>
  Result.map(expectedPackages(raw.packagesRaw), (packages) => {
    const reads = raw.bytes.map((bytes) => ({ dir: bytes.dir, ...decodedPart(bytes) }))
    return {
      command: MergeReportPartsCommand.make({
        parts: reads.flatMap((read) => Option.toArray(read.part)),
        expectedPackages: packages,
      }),
      skipped: reads.flatMap((read) => Option.match(read.part, { onNone: () => [read.dir], onSome: () => [] })),
      unreadable: reads.flatMap((read) =>
        Match.value(read.unreadable).pipe(
          Match.when(true, () => [read.dir]),
          Match.when(false, () => []),
          Match.exhaustive,
        )
      ),
    }
  })

const refusalText = ({
  error,
  partsDir,
}: {
  readonly error: typeof DuplicatePackageLabel.Encoded | typeof MissingPackages.Encoded
  readonly partsDir: string
}) =>
  Match.value(error).pipe(
    Match.tag('DuplicatePackageLabel', (duplicate) => `duplicate package ${duplicate.label}`),
    Match.tag(
      'MissingPackages',
      (missing) =>
        Match.value(missing.packages.length === 0).pipe(
          Match.when(true, () => `no mutation report parts under ${partsDir}`),
          Match.when(false, () => `no mutation report parts under ${partsDir} for ${missing.packages.join(', ')}`),
          Match.exhaustive,
        ),
    ),
    Match.exhaustive,
  )

const TABLE_HEADER = [
  '| package | score | killed | survived | no cov | timeout | compile err | verdict |',
  '| --- | --: | --: | --: | --: | --: | --: | :-: |',
]

const rowLine = (row: VerdictRow) => `| ${row.label} | ${row.score} | ${row.cells.join(' | ')} | ${row.verdict} |`

const survivorLine = (survivor: Survivor) =>
  `- \`${survivor.file}:${survivor.line}:${survivor.column}\` ${survivor.status} \`${survivor.mutatorName}\` → \`${survivor.replacement}\``

const whenNonEmpty = (count: number, lines: readonly string[]) =>
  Match.value(count > 0).pipe(
    Match.when(true, () => lines),
    Match.when(false, () => []),
    Match.exhaustive,
  )

const encodeSummary = (
  rows: readonly VerdictRow[],
  survivors: readonly Survivor[],
  skipped: readonly string[],
  unreadableCount: number,
) => {
  const packageRows = rows.filter((row) => row.label !== ALL_PACKAGES)
  const merged = packageRows.filter((row) => row.score !== 'no report').length
  const overflow = Match.value(survivors.length > SURVIVOR_CAP).pipe(
    Match.when(true, () => [
      `- … and ${survivors.length - SURVIVOR_CAP} more; see mutation-report.html in the run artifact.`,
    ]),
    Match.when(false, () => []),
    Match.exhaustive,
  )
  return `${
    [
      '## Mutation',
      '',
      `Merged ${merged} of ${packageRows.length} package report(s).`,
      '',
      ...TABLE_HEADER,
      ...rows.map(rowLine),
      ...whenNonEmpty(survivors.length, [
        '',
        '### Survivors',
        '',
        ...survivors.slice(0, SURVIVOR_CAP).map(survivorLine),
        ...overflow,
      ]),
      ...whenNonEmpty(skipped.length, [
        '',
        '### Warnings',
        '',
        ...skipped.map((name) => `- \`${name}\`: no readable mutation-part.json`),
      ]),
      ...whenNonEmpty(unreadableCount, ['', `Report exited non-zero: ${unreadableCount} unreadable part(s).`]),
    ].join('\n')
  }\n`
}

const encodeMerge = ({
  decoded,
  rows,
  survivors,
  report,
}: {
  readonly decoded: { readonly skipped: readonly string[]; readonly unreadable: readonly string[] }
  readonly rows: readonly VerdictRow[]
  readonly survivors: readonly Survivor[]
  readonly report: MutationReport | undefined
}): EncodedMerge => ({
  summary: encodeSummary(rows, survivors, decoded.skipped, decoded.unreadable.length),
  report,
  unreadable: decoded.unreadable,
})

const encodeReport = Effect.fn('stryker.merge_reports.encode_report')(function*(report: MutationReport) {
  return yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))(report).pipe(Effect.orDie)
})

const putFile = Effect.fn('stryker.merge_reports.put_file')(function*(
  file: string,
  content: string,
  append: boolean,
) {
  yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) =>
      Match.value(append).pipe(
        Match.when(true, () => fs.writeFileString(file, content, { flag: 'a' })),
        Match.when(false, () => fs.writeFileString(file, content)),
        Match.exhaustive,
      )
    ),
    Effect.catchCause(() => failReason(`cannot write ${file}`)),
  )
})

const toStream = (events: readonly Reporter.ReporterEvent[]): AsyncIterable<Reporter.ReporterEvent> =>
  Stream.toAsyncIterable(Stream.fromIterable([...events]))

const renderHtmlReport = Effect.fn('stryker.merge_reports.render_html')(function*(
  fileName: string,
  report: MutationReport,
  options: Options.StrykerOptions,
) {
  const metrics = MetricsResultFromReport.fromFiles(report.files)
  yield* HtmlReporter.makeHtmlReporter(options, {})(
    toStream([Reporter.MutationTestReportReady.make({ report, metrics })]),
  ).pipe(Effect.catchCause(() => failReason(`cannot write the html report at ${fileName}`)))
})

const writeHtml = Effect.fn('stryker.merge_reports.write_html')(function*(fileName: string, report: MutationReport) {
  return yield* Option.match(S.decodeOption(Options.StrykerOptionsSchema)({ htmlReporter: { fileName } }), {
    onNone: () => failReason(`cannot configure the html report at ${fileName}`),
    onSome: (options) => renderHtmlReport(fileName, report, options),
  })
})

export const writeEncoded = Effect.fn('stryker.merge_reports.write_files')(function*(input: {
  readonly body: EncodedMerge
  readonly raw: MergeCommand
}) {
  const { body, raw } = input
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(raw.out, { recursive: true }).pipe(
    Effect.catchCause(() => failReason(`cannot create ${raw.out}`)),
  )
  yield* Option.match(Option.fromNullishOr(body.report), {
    onNone: () => Effect.void,
    onSome: (report) =>
      encodeReport(report).pipe(
        Effect.flatMap((json) =>
          putFile(path.join(raw.out, OUT_REPORT), json, false).pipe(
            Effect.andThen(writeHtml(path.join(raw.out, OUT_HTML), report)),
          )
        ),
      ),
  })
  yield* putFile(path.join(raw.out, OUT_SUMMARY), body.summary, false)
  const step = yield* Config.String(STEP_SUMMARY).pipe(Effect.option)
  yield* Option.match(step, {
    onNone: () => Effect.void,
    onSome: (file) =>
      Match.value(file.length > 0).pipe(
        Match.when(true, () => putFile(file, body.summary, true)),
        Match.when(false, () => Effect.void),
        Match.exhaustive,
      ),
  })
  yield* Match.value(raw.mode).pipe(
    Match.when('human', () => Console.log(body.summary)),
    Match.when('machine', () => Effect.void),
    Match.exhaustive,
  )
  yield* Match.value(body.unreadable.length > 0).pipe(
    Match.when(true, () => failReason(`${body.unreadable.length} unreadable part(s): ${body.unreadable.join(', ')}`)),
    Match.when(false, () => Effect.void),
    Match.exhaustive,
  )
})

const readMerge = Effect.fn('stryker.merge_reports.gather')(function*(request: MergeReportsInvocation) {
  const fs = yield* FileSystem.FileSystem
  const present = yield* fs.exists(request.parts).pipe(Effect.orElseSucceed(() => false))
  yield* Effect.filterOrFail(
    Effect.succeed(present),
    (exists) => exists,
    () => request.parts,
  ).pipe(
    Effect.mapError((partsDir) => MergeReportsFailed.make({ reason: `no such parts directory ${partsDir}` })),
    Effect.tapError((failure) => Console.error(`stryker merge-reports: ${failure.reason}`)),
  )
  const dirs = yield* collectPartDirs(request.parts)
  const bytes = yield* Effect.forEach(dirs, readPartBytes)
  return yield* Effect.fromResult(decodeMerge({ packagesRaw: request.packages, bytes })).pipe(
    Effect.map(({ command, skipped, unreadable }) =>
      Object.assign(command, {
        out: request.out,
        partsDir: request.parts,
        skipped,
        unreadable,
        mode: request.mode,
      })
    ),
  )
})

const writeMergedReports = Effect.fn('stryker.merge_reports.write_merged')(function*(
  merged: {
    readonly rows: readonly VerdictRow[]
    readonly survivors: readonly Survivor[]
    readonly report: MutationReport
  },
  raw: MergeCommand,
) {
  return yield* writeEncoded({
    body: encodeMerge({ decoded: raw, rows: merged.rows, survivors: merged.survivors, report: merged.report }),
    raw,
  })
})

const writeNoMergedReports = Effect.fn('stryker.merge_reports.write_absent')(function*(
  absent: { readonly rows: readonly VerdictRow[] },
  raw: MergeCommand,
) {
  return yield* writeEncoded({
    body: encodeMerge({ decoded: raw, rows: absent.rows, survivors: [], report: undefined }),
    raw,
  })
})

const refuseParts = Effect.fn('stryker.merge_reports.refuse_parts')(function*(
  error: typeof DuplicatePackageLabel.Encoded | typeof MissingPackages.Encoded,
  raw: MergeCommand,
) {
  return yield* failReason(refusalText({ error, partsDir: raw.partsDir }))
})

const refuseCommand = Effect.fn('stryker.merge_reports.refuse_command')(function*(
  issue: string,
  raw: MergeCommand,
) {
  return yield* failReason(`invalid merge command under ${raw.partsDir}: ${issue}`)
})

export const mergeReportsCell = Sandwich.named('stryker.merge_reports')(readMerge)
  .decide(mergeReportParts)
  .write({
    MergedReports: (merged, raw) => writeMergedReports(merged, raw),
    NoMergedReports: (absent, raw) => writeNoMergedReports(absent, raw),
    DuplicatePackageLabel: (error, raw) => refuseParts(error, raw),
    MissingPackages: (error, raw) => refuseParts(error, raw),
    CommandRejected: ({ issue }, raw) => refuseCommand(issue, raw),
  })
