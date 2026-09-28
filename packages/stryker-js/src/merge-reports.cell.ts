import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { type OutputMode, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import type { MergeReportsRequest } from './Cli.schema.js'
import {
  DuplicatePackageLabel,
  MergedReports,
  mergeReportParts,
  MissingPackages,
} from './merge-report-parts.workflow.js'
import {
  decodeMerge,
  encodeMerge,
  failReason,
  INCREMENTAL_PART_NAME,
  type MergeCommand,
  type VerdictRow,
  writeEncoded,
} from './merge-reports.js'
import { MergeReportsFailed } from './merge-reports.schema.js'
import {
  MutationPartFileName,
  MutationReportFileName,
  MutationStreamFileName,
} from './reporting/report-assembly.schema.js'

const PART_MARKER = MutationPartFileName.literal
const PART_REPORT = MutationReportFileName.literal
const PART_STREAM = MutationStreamFileName.literal
export type MergeReportsInvocation = MergeReportsRequest & { readonly mode: OutputMode.OutputMode }

const readText = Effect.fn(SpanTaxonomy.Spans.mergeReportsReadText.name)(function*(file: string) {
  return yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.option,
    Effect.map(Option.getOrUndefined),
  )
})

const listNames = Effect.fn(SpanTaxonomy.Spans.mergeReportsListNames.name)(function*(dir: string) {
  return yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readDirectory(dir)),
    Effect.orElseSucceed((): readonly string[] => []),
    Effect.map((names) => [...names].sort()),
  )
})

const directoryExists = Effect.fn(SpanTaxonomy.Spans.mergeReportsDirectoryExists.name)(function*(full: string) {
  return yield* FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.stat(full)),
    Effect.option,
    Effect.map((info) => Option.exists(info, (entry) => entry.type === 'Directory')),
  )
})

const collectPartDirs: (
  dir: string,
) => Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> = Effect.fn(
  SpanTaxonomy.Spans.mergeReportsCollectPartDirs.name,
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

const readIncrementalTexts = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): readonly string[] => []))
  const incremental = [...names].filter((name) => INCREMENTAL_PART_NAME.test(name)).sort()
  const texts = yield* Effect.forEach(incremental, (name) => readText(path.join(dir, name)), { concurrency: 1 })
  return texts.filter((text): text is string => text !== undefined)
})

const readPartBytes = Effect.fn(SpanTaxonomy.Spans.mergeReportsReadPart.name)(function*(dir: string) {
  const path = yield* Path.Path
  return {
    dir,
    metaText: yield* readText(path.join(dir, PART_MARKER)),
    reportText: yield* readText(path.join(dir, PART_REPORT)),
    streamText: yield* readText(path.join(dir, PART_STREAM)),
    incrementalTexts: yield* readIncrementalTexts(dir),
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

const readMerge = Effect.fn(SpanTaxonomy.Spans.mergeReportsGather.name)(function*(request: MergeReportsInvocation) {
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
    Effect.map(({ command, skipped, unreadable }): MergeCommand => ({
      ...command,
      out: request.out,
      partsDir: request.parts,
      skipped,
      unreadable,
      mode: request.mode,
    })),
  )
})

const writeMergedReports = Effect.fn(SpanTaxonomy.Spans.mergeReportsWriteMerged.name)(function*(
  merged: typeof MergedReports.Encoded,
  raw: MergeCommand,
) {
  const report = yield* S.decodeEffect(Report.MutationTestResult)(merged.report).pipe(Effect.orDie)
  return yield* writeEncoded({
    body: encodeMerge({ decoded: raw, rows: merged.rows, survivors: merged.survivors, report }),
    raw,
  })
})

const writeNoMergedReports = Effect.fn(SpanTaxonomy.Spans.mergeReportsWriteAbsent.name)(function*(
  absent: { readonly rows: readonly VerdictRow[] },
  raw: MergeCommand,
) {
  return yield* writeEncoded({
    body: encodeMerge({ decoded: raw, rows: absent.rows, survivors: [], report: undefined }),
    raw,
  })
})

const refuseParts = Effect.fn(SpanTaxonomy.Spans.mergeReportsRefuseParts.name)(function*(
  error: typeof DuplicatePackageLabel.Encoded | typeof MissingPackages.Encoded,
  raw: MergeCommand,
) {
  return yield* failReason(refusalText({ error, partsDir: raw.partsDir }))
})

const refuseCommand = Effect.fn(SpanTaxonomy.Spans.mergeReportsRefuseCommand.name)(function*(
  issue: string,
  raw: MergeCommand,
) {
  return yield* failReason(`invalid merge command under ${raw.partsDir}: ${issue}`)
})

export const mergeReportsCell = Sandwich.named(SpanTaxonomy.Spans.mergeReports.name)(readMerge)
  .decide(mergeReportParts)
  .write({
    MergedReports: (merged, raw) => writeMergedReports(merged, raw),
    NoMergedReports: (absent, raw) => writeNoMergedReports(absent, raw),
    DuplicatePackageLabel: (error, raw) => refuseParts(error, raw),
    MissingPackages: (error, raw) => refuseParts(error, raw),
    CommandRejected: ({ issue }, raw) => refuseCommand(issue, raw),
  })
