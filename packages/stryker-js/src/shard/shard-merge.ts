import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { writeFileAtomic } from '../atomic-write.cell.js'
import { reportFromStream, ReportFromStreamCommand, ReportFromStreamRebuilt } from '../report-from-stream.workflow.js'
import { INCREMENTAL_PART_NAME, unionIncrementalReports } from './incremental-union.js'
import {
  mergeShardReports,
  MergeShardReportsCommand,
  type ReportedShardProject,
  type ShardMutantVerdict,
  type ShardReportGap,
  type ShardReportOverlap,
} from './merge-shard-reports.workflow.js'
import { ShardMergeFailed } from './shard-merge.schema.js'

const STREAM_FILE = 'mutation-stream.jsonl'
const REPORT_FILE = 'mutation.json'
const INCREMENTAL_FILE = 'stryker-incremental.json'
const DEFAULT_OUT = 'reports/mutation'
const DEFAULT_SCHEMA_VERSION = '1.0'
const DEFAULT_THRESHOLDS = { high: 80, low: 60, break: null }
const SEGMENT_SEPARATORS = /[/\\]/

export interface ShardMergeInput {
  readonly plan: ShardPlan
  readonly planDirectory: string
  readonly shardDirs: readonly string[]
  readonly out: string | undefined
  readonly basePath: string
}

interface ProjectReport {
  readonly project: string
  readonly report: Report.MutationTestResult
}

interface CollectedReports {
  readonly reports: readonly ReportedShardProject[]
  readonly projectReports: readonly ProjectReport[]
  readonly incrementalTexts: readonly string[]
}

const readText = (file: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.map(
    Effect.option(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.readFileString(file)))),
    (text) => Option.getOrUndefined(text),
  )

const rebuiltReportOf = (text: string | undefined): Option.Option<Report.MutationTestResult> =>
  Option.flatMap(Option.fromUndefinedOr(text), (present) =>
    Result.match(resultOfReport(present), {
      onFailure: () => Option.none<Report.MutationTestResult>(),
      onSuccess: (decision) =>
        Option.map(Option.liftPredicate(decision, S.is(ReportFromStreamRebuilt)), (rebuilt) => rebuilt.report),
    }))

const resultOfReport = (text: string) => reportFromStream(ReportFromStreamCommand.make({ text }))

const incrementalTextsOf = (dir: string): Effect.Effect<readonly string[], never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): readonly string[] => []))
    const candidates = [...names].filter((name) => INCREMENTAL_PART_NAME.test(name)).sort()
    const texts = yield* Effect.forEach(candidates, (name) => readText(`${dir}/${name}`), { concurrency: 1 })
    return texts.filter((text): text is string => text !== undefined)
  })

const normalizeProject = (project: string): string => project.split(SEGMENT_SEPARATORS).filter(Boolean).join('/')

const fileKeyOf = (project: string, file: string): string => {
  const normalized = normalizeProject(project)
  return normalized === '' ? file : `${normalized}/${file}`
}

const dedupeMutants = (mutants: readonly Report.MutantResult[]): readonly Report.MutantResult[] =>
  Record.values(
    Arr.reduce(
      mutants,
      Record.empty<string, Report.MutantResult>(),
      (byId, mutant) => Record.set(byId, mutant.id, mutant),
    ),
  )

const mergedFileOf = (
  previous: Option.Option<Report.FileResult>,
  next: Report.FileResult,
): Report.FileResult =>
  Option.match(previous, {
    onNone: () => next,
    onSome: (existing) => ({ ...next, mutants: dedupeMutants([...existing.mutants, ...next.mutants]) }),
  })

const mergeFiles = (reports: readonly ProjectReport[]): Record<string, Report.FileResult> =>
  Arr.reduce(
    reports.flatMap(({ project, report }) =>
      Object.entries(report.files).map(([file, fileResult]) => ({ key: fileKeyOf(project, file), fileResult }))
    ),
    Record.empty<string, Report.FileResult>(),
    (files, entry) => Record.set(files, entry.key, mergedFileOf(Record.get(files, entry.key), entry.fileResult)),
  )

const headReportOf = (reports: readonly ProjectReport[]): Option.Option<ProjectReport> => Arr.head(reports)

const schemaVersionOf = (reports: readonly ProjectReport[]): string =>
  Option.getOrElse(
    Option.map(headReportOf(reports), (first) => first.report.schemaVersion),
    () => DEFAULT_SCHEMA_VERSION,
  )

const thresholdsOf = (reports: readonly ProjectReport[]): Report.Thresholds =>
  Option.getOrElse(Option.map(headReportOf(reports), (first) => first.report.thresholds), () => DEFAULT_THRESHOLDS)

const mergedReportOf = (reports: readonly ProjectReport[]): Report.MutationTestResult => ({
  files: mergeFiles(reports),
  schemaVersion: schemaVersionOf(reports),
  thresholds: thresholdsOf(reports),
  config: {},
})

const mutantsOfReport = (report: Report.MutationTestResult): readonly Report.MutantResult[] =>
  Object.values(report.files).flatMap((file) => file.mutants)

const verdictsOf = (report: Report.MutationTestResult): readonly ShardMutantVerdict[] =>
  mutantsOfReport(report).map((mutant) => ({ id: mutant.id, status: mutant.status }))

const reportedOf = (
  shard: number,
  project: string,
  report: Option.Option<Report.MutationTestResult>,
): ReportedShardProject =>
  Option.match(report, {
    onNone: () => ({ shard, project, mutants: [] }),
    onSome: (present) => ({ shard, project, mutants: verdictsOf(present) }),
  })

const collectProject = (
  input: ShardMergeInput,
  path: Path.Path,
  dir: string,
  shard: number,
  project: { readonly project: string },
): Effect.Effect<
  {
    readonly reported: ReportedShardProject
    readonly projectReport: Option.Option<ProjectReport>
    readonly incrementalTexts: readonly string[]
  },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function*() {
    const projectDir = path.join(path.resolve(input.basePath, dir), project.project)
    const report = rebuiltReportOf(yield* readText(path.join(projectDir, STREAM_FILE)))
    const incrementalTexts = yield* incrementalTextsOf(projectDir)
    return {
      reported: reportedOf(shard, project.project, report),
      projectReport: Option.map(report, (present) => ({ project: project.project, report: present })),
      incrementalTexts,
    }
  })

const collectShardReports = (
  input: ShardMergeInput,
  path: Path.Path,
  dir: string,
  shard: { readonly index: number; readonly projects: ReadonlyArray<{ readonly project: string }> },
): Effect.Effect<CollectedReports, never, FileSystem.FileSystem> =>
  Effect.forEach(
    shard.projects,
    (project) => collectProject(input, path, dir, shard.index, project),
    { concurrency: 1 },
  ).pipe(
    Effect.map((parts) => ({
      reports: parts.map((part) => part.reported),
      projectReports: Arr.getSomes(parts.map((part) => part.projectReport)),
      incrementalTexts: parts.flatMap((part) => part.incrementalTexts),
    })),
  )

const collectProjectReports = (
  input: ShardMergeInput,
  path: Path.Path,
): Effect.Effect<CollectedReports, ShardMergeFailed, FileSystem.FileSystem> =>
  Effect.forEach(
    input.shardDirs.map((dir, index) => ({ dir, index })),
    (entry) =>
      Option.match(Option.fromUndefinedOr(input.plan.shards[entry.index]), {
        onNone: () =>
          Effect.fail(
            ShardMergeFailed.make({
              reason: `more shard directories than shards: ${input.shardDirs.length} > ${input.plan.shards.length}`,
            }),
          ),
        onSome: (shard) => collectShardReports(input, path, entry.dir, shard),
      }),
    { concurrency: 1 },
  ).pipe(
    Effect.map((parts) => ({
      reports: parts.flatMap((part) => part.reports),
      projectReports: parts.flatMap((part) => part.projectReports),
      incrementalTexts: parts.flatMap((part) => part.incrementalTexts),
    })),
  )

const shardsOf = (input: ShardMergeInput) =>
  input.plan.shards.map((shard) => ({
    index: shard.index,
    projects: shard.projects.map((project) => ({ project: project.project, mutants: project.mutants })),
  }))

const outputDirOf = (input: ShardMergeInput, path: Path.Path): string =>
  path.resolve(input.basePath, input.out ?? DEFAULT_OUT)

export const mergeShards = (
  input: ShardMergeInput,
): Effect.Effect<
  void,
  ShardReportGap | ShardReportOverlap | ShardMergeFailed,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const collected = yield* collectProjectReports(input, path)
    const decision = yield* Effect.fromResult(
      mergeShardReports(
        MergeShardReportsCommand.make({
          shards: shardsOf(input),
          reports: collected.reports,
        }),
      ),
    )
    const outDir = outputDirOf(input, path)
    yield* fs.makeDirectory(outDir, { recursive: true })
    const json = yield* Effect.orDie(
      S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))(mergedReportOf(collected.projectReports)),
    )
    yield* writeFileAtomic({ fs, path }, path.join(outDir, REPORT_FILE), json)
    yield* Option.match(Option.fromUndefinedOr(unionIncrementalReports(collected.incrementalTexts)), {
      onNone: () => Effect.void,
      onSome: (incremental) => writeFileAtomic({ fs, path }, path.join(outDir, INCREMENTAL_FILE), incremental),
    })
    yield* Effect.logInfo(
      `stryker merge: merged ${
        decision.projects.reduce((count, project) => count + project.mutants.length, 0)
      } mutant verdict(s) into ${outDir}`,
    )
  }).pipe(
    Effect.catchTag('PlatformError', () =>
      Effect.fail(ShardMergeFailed.make({ reason: 'cannot read the shard reports or write the merged report' }))),
  )
