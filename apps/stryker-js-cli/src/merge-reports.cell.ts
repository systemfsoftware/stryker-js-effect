import { Cell } from '@systemfsoftware/effect-cell-types'
import { calculateMetrics } from '@systemfsoftware/stryker-js-engine'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { MutationTestReportReady } from '@systemfsoftware/stryker-js-language'
import { MutationTestResultSchema } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { MergeReportsRequest } from './Cli.schema.js'
import {
  DuplicatePackageLabel,
  MergedReports,
  mergeReportParts,
  MergeReportPartsCommand,
  MissingPackages,
  NoMergedReports,
} from './merge-report-parts.workflow.js'
import {
  MergeReportsFailed,
  PartMetaSchema,
  type StreamMutantLine,
  StreamMutantLineSchema,
} from './merge-reports.schema.js'

const PART_MARKER = 'mutation-part.json'
const PART_REPORT = 'mutation-report.json'
const PART_STREAM = 'mutation-stream.jsonl'
const OUT_REPORT = 'mutation-report.json'
const OUT_HTML = 'mutation-report.html'
const OUT_SUMMARY = 'summary.md'
const STREAM_THRESHOLDS = { high: 100, low: 80 }
const SURVIVOR_CAP = 100
const ALL_PACKAGES = '**all**'
const STEP_SUMMARY = 'GITHUB_STEP_SUMMARY'

const refuse = (reason: string) => MergeReportsFailed.make({ reason })

const failReason = (reason: string) =>
  Console.error(`stryker merge-reports: ${reason}`).pipe(Effect.andThen(Effect.fail(refuse(reason))))

const readText = (file: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.option,
    Effect.map(Option.getOrUndefined),
  )

const listNames = (dir: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readDirectory(dir)),
    Effect.orElseSucceed(() => []),
    Effect.map((names) => [...names].sort()),
  )

const directoryExists = (full: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.stat(full)),
    Effect.option,
    Effect.map((info) => Option.exists(info, (entry) => entry.type === 'Directory')),
  )
const collectPartDirs = (root: string): Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const walk = (dir: string): Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function*() {
        const names = yield* listNames(dir)
        const entries = yield* Effect.forEach(names, (name) => {
          const full = path.join(dir, name)
          return directoryExists(full).pipe(Effect.map((isDir) => ({ dir, name, full, isDir })))
        })
        const isPartDir = entries.some((entry) => !entry.isDir && entry.name === PART_MARKER)
        const current = [dir].filter(() => isPartDir)
        const subDirs = entries.filter((entry) => entry.isDir).map((entry) => entry.full)
        const subMatches = yield* Effect.forEach(subDirs, walk)
        return [...current, ...subMatches.flat()]
      })
    return yield* walk(root)
  })

const readPartBytes = (dir: string) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    return {
      dir,
      metaText: yield* readText(path.join(dir, PART_MARKER)),
      reportText: yield* readText(path.join(dir, PART_REPORT)),
      streamText: yield* readText(path.join(dir, PART_STREAM)),
    }
  })

type MergeCommand = MergeReportPartsCommand & {
  readonly out: string
  readonly partsDir: string
  readonly skipped: readonly string[]
  readonly unreadable: readonly string[]
}

const readMerge = (
  request: MergeReportsRequest,
): Effect.Effect<MergeCommand, MergeReportsFailed, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const present = yield* fs.exists(request.parts).pipe(Effect.orElseSucceed(() => false))
    yield* Match.value(present).pipe(
      Match.when(true, () => Effect.void),
      Match.when(false, () => failReason(`no such parts directory ${request.parts}`)),
      Match.exhaustive,
    )
    const dirs = yield* collectPartDirs(request.parts)
    const bytes = yield* Effect.forEach(dirs, readPartBytes)
    return yield* Result.match(decodeMerge({ packagesRaw: request.packages, bytes }), {
      onFailure: (error) => Effect.fail(error),
      onSuccess: ({ command, skipped, unreadable }) =>
        Effect.succeed(
          Object.assign(command, { out: request.out, partsDir: request.parts, skipped, unreadable }),
        ),
    })
  })

const mutantFromStream = (line: StreamMutantLine) => {
  const mutant = {
    id: line.id,
    mutatorName: line.mutator,
    status: line.status,
    location: line.location,
  }
  return Option.match(
    Option.liftPredicate(line.replacement, (value) => typeof value === 'string'),
    {
      onNone: () => mutant,
      onSome: (replacement) => ({ ...mutant, replacement }),
    },
  )
}

const streamLines = (text: string) => {
  const decodeLine = S.decodeUnknownOption(S.fromJsonString(StreamMutantLineSchema))
  return text.split('\n').flatMap((raw) => Option.toArray(decodeLine(raw.trim())))
}

const reportFromStream = (text: string) => {
  const grouped = streamLines(text).reduce(
    (groups: Record<string, ReturnType<typeof mutantFromStream>[]>, line) => {
      const mutants = [...(groups[line.file] ?? []), mutantFromStream(line)]
      return { ...groups, [line.file]: mutants }
    },
    {},
  )
  return Option.map(
    Option.liftPredicate(grouped, (files) => Object.keys(files).length > 0),
    (files) => ({
      schemaVersion: '1.0',
      thresholds: STREAM_THRESHOLDS,
      files: Object.fromEntries(
        Object.entries(files).map(([file, mutants]) => [file, { language: 'javascript', source: '', mutants }]),
      ),
    }),
  )
}

const decodedPart = (bytes: {
  readonly dir: string
  readonly metaText: string | undefined
  readonly reportText: string | undefined
  readonly streamText: string | undefined
}) =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(bytes.metaText), S.decodeUnknownOption(S.fromJsonString(PartMetaSchema))),
    {
      onNone: () => ({ part: Option.none(), unreadable: false }),
      onSome: (meta) => {
        const base = { label: meta.package, outcome: meta.outcome, incomplete: false }
        return Option.match(Option.fromNullishOr(bytes.reportText), {
          onSome: (text) =>
            Option.match(S.decodeUnknownOption(S.fromJsonString(MutationTestResultSchema))(text), {
              onNone: () => ({ part: Option.some(base), unreadable: true }),
              onSome: (report) => ({ part: Option.some({ ...base, report }), unreadable: false }),
            }),
          onNone: () =>
            Option.match(Option.flatMap(Option.fromNullishOr(bytes.streamText), reportFromStream), {
              onNone: () => ({ part: Option.some(base), unreadable: false }),
              onSome: (report) => ({ part: Option.some({ ...base, incomplete: true, report }), unreadable: false }),
            }),
        })
      },
    },
  )

const expectedPackages = (raw: string | undefined) =>
  Option.match(Option.filter(Option.fromNullishOr(raw), (text) => text.length > 0), {
    onNone: () => Result.succeed(undefined),
    onSome: (text) =>
      Option.match(S.decodeUnknownOption(S.fromJsonString(S.Array(S.String)))(text), {
        onNone: () => Result.fail(refuse(`--packages is not a JSON array: ${text}`)),
        onSome: (packages) => Result.succeed(packages),
      }),
  })

const decodeMerge = (raw: {
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

const refusalText = (error: DuplicatePackageLabel | MissingPackages, partsDir: string) =>
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

const rowLine = (
  row: { readonly label: string; readonly score: string; readonly cells: readonly string[]; readonly verdict: string },
) => `| ${row.label} | ${row.score} | ${row.cells.join(' | ')} | ${row.verdict} |`

const survivorLine = (survivor: {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly status: string
  readonly mutatorName: string
  readonly replacement: string
}) =>
  `- \`${survivor.file}:${survivor.line}:${survivor.column}\` ${survivor.status} \`${survivor.mutatorName}\` → \`${survivor.replacement}\``

const whenNonEmpty = (count: number, lines: readonly string[]) =>
  Match.value(count > 0).pipe(
    Match.when(true, () => lines),
    Match.when(false, () => []),
    Match.exhaustive,
  )

const encodeSummary = (
  rows: readonly {
    readonly label: string
    readonly score: string
    readonly cells: readonly string[]
    readonly verdict: string
  }[],
  survivors: readonly {
    readonly file: string
    readonly line: number
    readonly column: number
    readonly status: string
    readonly mutatorName: string
    readonly replacement: string
  }[],
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

const encodeMerge = (
  outcome: Result.Result<MergedReports | NoMergedReports, DuplicatePackageLabel | MissingPackages>,
  decoded: { readonly skipped: readonly string[]; readonly unreadable: readonly string[] },
) =>
  Result.map(outcome, (decision) =>
    Match.value(decision).pipe(
      Match.tag('MergedReports', (merged) => ({
        summary: encodeSummary(merged.rows, merged.survivors, decoded.skipped, decoded.unreadable.length),
        report: merged.report,
        unreadable: decoded.unreadable,
      })),
      Match.tag('NoMergedReports', (absent) => ({
        summary: encodeSummary(absent.rows, [], decoded.skipped, decoded.unreadable.length),
        report: undefined,
        unreadable: decoded.unreadable,
      })),
      Match.exhaustive,
    ))

const putFile = (file: string, content: string, append: boolean) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) =>
      Match.value(append).pipe(
        Match.when(true, () => fs.writeFileString(file, content, { flag: 'a' })),
        Match.when(false, () => fs.writeFileString(file, content)),
        Match.exhaustive,
      )
    ),
    Effect.catchCause(() => failReason(`cannot write ${file}`)),
  )

const htmlEvents = (report: typeof MutationTestResultSchema.Type) => ({
  async *[Symbol.asyncIterator]() {
    yield new MutationTestReportReady({ report, metrics: calculateMetrics(report.files) })
  },
})

const writeHtml = (fileName: string, report: typeof MutationTestResultSchema.Type) =>
  Option.match(S.decodeUnknownOption(StrykerOptionsSchema)({ htmlReporter: { fileName } }), {
    onNone: () => failReason(`cannot configure the html report at ${fileName}`),
    onSome: (options) =>
      Effect.tryPromise({
        try: () => makeHtmlReporter(options, {})(htmlEvents(report)),
        catch: () => refuse(`cannot configure the html report at ${fileName}`),
      }).pipe(Effect.catch((error) => failReason(error.reason))),
  })

type EncodedMerge = {
  readonly summary: string
  readonly report: typeof MutationTestResultSchema.Type | undefined
  readonly unreadable: readonly string[]
}

type MergeOutcome = Result.Result<MergedReports | NoMergedReports, DuplicatePackageLabel | MissingPackages>

const writeEncoded = (
  document: Result.Result<EncodedMerge, DuplicatePackageLabel | MissingPackages>,
  raw: MergeCommand,
) =>
  Result.match(document, {
    onFailure: (error) => failReason(refusalText(error, raw.partsDir)),
    onSuccess: (body) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        yield* fs.makeDirectory(raw.out, { recursive: true }).pipe(
          Effect.catchCause(() => failReason(`cannot create ${raw.out}`)),
        )
        yield* Option.match(Option.fromNullishOr(body.report), {
          onNone: () => Effect.void,
          onSome: (report) =>
            putFile(path.join(raw.out, OUT_REPORT), JSON.stringify(report), false).pipe(
              Effect.andThen(writeHtml(path.join(raw.out, OUT_HTML), report)),
            ),
        })
        yield* putFile(path.join(raw.out, OUT_SUMMARY), body.summary, false)
        const step = yield* Config.string(STEP_SUMMARY).pipe(Effect.option)
        yield* Option.match(step, {
          onNone: () => Effect.void,
          onSome: (file) =>
            Match.value(file.length > 0).pipe(
              Match.when(true, () => putFile(file, body.summary, true)),
              Match.when(false, () => Effect.void),
              Match.exhaustive,
            ),
        })
        yield* Console.log(body.summary)
        yield* Match.value(body.unreadable.length > 0).pipe(
          Match.when(true, () =>
            failReason(`${body.unreadable.length} unreadable part(s): ${body.unreadable.join(', ')}`)),
          Match.when(false, () =>
            Effect.void),
          Match.exhaustive,
        )
      }),
  })

export const mergeReportsCell = Cell.layer({
  read: readMerge,
  decide: mergeReportParts,
  write: (outcome: MergeOutcome, raw: MergeCommand) => writeEncoded(encodeMerge(outcome, raw), raw),
})
