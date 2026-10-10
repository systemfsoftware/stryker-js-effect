import {
  type AnnotationParseFailure,
  confirmAnnotations,
  ConfirmAnnotationsCommand,
  matchAnnotations,
  MatchAnnotationsCommand,
  type MatchedAnnotation,
  parseAnnotations,
  ParseAnnotationsCommand,
  type ReportMutant,
  type SourcedAnnotation,
  type SourceLine,
} from '@systemfsoftware/stryker-e2e-core'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Check, Expect } from '@systemfsoftware/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export interface AnnotatedRun {
  readonly fixture: string
  readonly slice: string
  readonly report: Report.MutationTestResult
  readonly verdict: RunEvent.VerdictReached
}

export class AnnotationOracleUnreadable extends S.TaggedError<AnnotationOracleUnreadable>()(
  'AnnotationOracleUnreadable',
  { fixture: S.String, file: S.String, reason: S.String },
) {
  override get message(): string {
    return `annotation oracle: ${this.fixture}/${this.file} could not be read: ${this.reason}`
  }
}

/**
 * The per-status totals the annotation tally and the terminal verdict must agree on. Kill-like outcomes are
 * merged because the report splits them the fixture cannot: an annotation may claim `KilledOrTimeout`, so
 * the surviving anonymity is only `counts.killed + counts.timeout`.
 */
export interface StatusTotals {
  readonly killedOrTimeout: number
  readonly survived: number
  readonly noCoverage: number
  readonly compileErrors: number
  readonly runtimeErrors: number
  readonly ignored: number
  readonly pending: number
}

const NO_TOTALS: StatusTotals = {
  killedOrTimeout: 0,
  survived: 0,
  noCoverage: 0,
  compileErrors: 0,
  runtimeErrors: 0,
  ignored: 0,
  pending: 0,
}

const INCREMENT: Readonly<Record<Mutant.MutantStatus, (totals: StatusTotals) => StatusTotals>> = {
  Killed: (totals) => ({ ...totals, killedOrTimeout: totals.killedOrTimeout + 1 }),
  Timeout: (totals) => ({ ...totals, killedOrTimeout: totals.killedOrTimeout + 1 }),
  Survived: (totals) => ({ ...totals, survived: totals.survived + 1 }),
  NoCoverage: (totals) => ({ ...totals, noCoverage: totals.noCoverage + 1 }),
  CompileError: (totals) => ({ ...totals, compileErrors: totals.compileErrors + 1 }),
  RuntimeError: (totals) => ({ ...totals, runtimeErrors: totals.runtimeErrors + 1 }),
  Ignored: (totals) => ({ ...totals, ignored: totals.ignored + 1 }),
  Pending: (totals) => ({ ...totals, pending: totals.pending + 1 }),
}

const annotationTotalsOf = (matched: ReadonlyArray<MatchedAnnotation>): StatusTotals =>
  matched.reduce(
    (totals, entry) =>
      Match.value(entry.annotation.annotation.outcome).pipe(
        Match.tag('Status', ({ status }) => INCREMENT[status](totals)),
        Match.tag('KilledOrTimeout', () => INCREMENT.Killed(totals)),
        Match.tag('CompileError', () => INCREMENT.CompileError(totals)),
        Match.tag('RuntimeError', () => INCREMENT.RuntimeError(totals)),
        Match.exhaustive,
      ),
    NO_TOTALS,
  )

const verdictTotalsOf = (counts: Report.Metrics): StatusTotals => ({
  killedOrTimeout: counts.killed + counts.timeout,
  survived: counts.survived,
  noCoverage: counts.noCoverage,
  compileErrors: counts.compileErrors,
  runtimeErrors: counts.runtimeErrors,
  ignored: counts.ignored,
  pending: counts.pending,
})

const linesOf = (content: string): ReadonlyArray<SourceLine> =>
  content.split('\n').map((text, index) => ({ number: index + 1, text }))

const annotationsOf = (
  file: string,
  content: string,
): Result.Result<ReadonlyArray<SourcedAnnotation>, AnnotationParseFailure> =>
  Result.map(
    parseAnnotations(ParseAnnotationsCommand.make({ file, lines: [...linesOf(content)] })),
    (annotations) => annotations.map((annotation): SourcedAnnotation => ({ file, annotation })),
  )

export const reportMutantsOf = (report: Report.MutationTestResult): ReadonlyArray<ReportMutant> =>
  Object.entries(report.files).flatMap(([file, fileResult]) =>
    fileResult.mutants.map((mutant): ReportMutant => ({ file, mutant }))
  )

const annotationTallyOf = (input: {
  readonly slice: string
  readonly annotations: ReadonlyArray<SourcedAnnotation>
  readonly mutants: ReadonlyArray<ReportMutant>
  readonly parseFailures: ReadonlyArray<string>
}) => {
  const matched = matchAnnotations(
    MatchAnnotationsCommand.make({
      slice: input.slice,
      annotations: [...input.annotations],
      mutants: [...input.mutants],
    }),
  )
  const confirmed = Result.flatMap(
    matched,
    (pairs) => confirmAnnotations(ConfirmAnnotationsCommand.make({ matched: pairs })),
  )
  const annotationFailures = Result.isFailure(matched)
    ? [...input.parseFailures, matched.failure.message]
    : Result.match(confirmed, {
      onFailure: (failure) => [...input.parseFailures, failure.message],
      onSuccess: () => [...input.parseFailures],
    })
  const mutantsMatched = Result.match(matched, { onFailure: () => 0, onSuccess: (pairs) => pairs.length })
  return { matched, annotationFailures, mutantsMatched }
}

export const statusesOf = (report: Report.MutationTestResult): ReadonlyArray<string> =>
  reportMutantsOf(report).map((entry) => entry.mutant.status)

export interface AnnotatedRunObservation {
  readonly mutantsReported: number
  readonly mutantsMatched: number
  readonly annotationFailures: ReadonlyArray<string>
  readonly statusTotals: StatusTotals
}

export interface AnnotatedRunComparison {
  readonly actual: AnnotatedRunObservation
  readonly expected: AnnotatedRunObservation
}

const comparisonOf = (input: {
  readonly slice: string
  readonly report: Report.MutationTestResult
  readonly verdict: RunEvent.VerdictReached
  readonly annotations: ReadonlyArray<SourcedAnnotation>
  readonly parseFailures: ReadonlyArray<string>
}): AnnotatedRunComparison => {
  const mutants = reportMutantsOf(input.report)
  const { matched, annotationFailures, mutantsMatched } = annotationTallyOf({
    slice: input.slice,
    annotations: input.annotations,
    mutants,
    parseFailures: input.parseFailures,
  })
  const annotationTotals = Result.match(matched, {
    onFailure: () => NO_TOTALS,
    onSuccess: (pairs) => annotationTotalsOf(pairs),
  })
  const verdictTotals = verdictTotalsOf(input.verdict.counts)
  return {
    actual: {
      mutantsReported: mutants.length,
      mutantsMatched,
      annotationFailures,
      statusTotals: verdictTotals,
    },
    expected: {
      mutantsReported: mutants.length,
      mutantsMatched: mutants.length,
      annotationFailures: [],
      statusTotals: annotationTotals,
    },
  }
}

const fixtureDirectoryOf = (
  path: Path.Path,
  fixture: string,
): Effect.Effect<string, AnnotationOracleUnreadable> =>
  Effect.mapError(
    path.fromFileUrl(new URL('../../testResources/', import.meta.url)),
    (cause) => AnnotationOracleUnreadable.make({ fixture, file: '', reason: cause.message }),
  ).pipe(Effect.map((base) => path.join(base, fixture)))

const fixtureAnnotationsOf = (
  input: { readonly fixture: string; readonly report: Report.MutationTestResult },
): Effect.Effect<
  { readonly annotations: ReadonlyArray<SourcedAnnotation>; readonly parseFailures: ReadonlyArray<string> },
  AnnotationOracleUnreadable,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fixtureDirectoryOf(path, input.fixture)
    const sources = yield* Effect.forEach(Object.keys(input.report.files), (file) =>
      Effect.map(
        fs.readFileString(path.join(directory, file)),
        (content) => ({ file, content }),
      ).pipe(
        Effect.mapError((cause) =>
          AnnotationOracleUnreadable.make({ fixture: input.fixture, file, reason: cause.message })
        ),
      ))
    const parsed = sources.map(({ file, content }) => annotationsOf(file, content))
    const parseFailures = parsed.flatMap((result) =>
      Result.match(result, { onFailure: (failure) => [failure.message], onSuccess: () => [] })
    )
    const annotations = parsed.flatMap((result) =>
      Result.match(result, {
        onFailure: (): ReadonlyArray<SourcedAnnotation> => [],
        onSuccess: (entries) => entries,
      })
    )
    return { annotations, parseFailures }
  })

export const compareAnnotatedRun = (
  input: AnnotatedRun,
): Effect.Effect<AnnotatedRunComparison, AnnotationOracleUnreadable, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    fixtureAnnotationsOf(input),
    ({ annotations, parseFailures }) =>
      comparisonOf({
        slice: input.slice,
        report: input.report,
        verdict: input.verdict,
        annotations,
        parseFailures,
      }),
  )

export const verifyAnnotatedRun = (
  expect: Expect,
  input: AnnotatedRun,
): Effect.Effect<Check, AnnotationOracleUnreadable, FileSystem.FileSystem | Path.Path> =>
  Effect.map(compareAnnotatedRun(input), (comparison) => expect(comparison.actual).toStrictEqual(comparison.expected))

export interface PersistedAnnotationObservation {
  readonly mutantsReported: number
  readonly mutantsMatched: number
  readonly annotationFailures: ReadonlyArray<string>
}

/**
 * The merged-shard-report oracle for a report with no run verdict of its own — the merged shard report. Every
 * reported mutant must match exactly one authored annotation and no annotation in a mutated file may dangle;
 * only the per-status tally agreement with a terminal verdict is unavailable here, because `stryker merge`
 * writes the report alone. A clean report observes `{ mutantsReported: n, mutantsMatched: n, annotationFailures: [] }`.
 */
export const persistedAnnotationsOf = (
  input: { readonly fixture: string; readonly slice: string; readonly report: Report.MutationTestResult },
): Effect.Effect<PersistedAnnotationObservation, AnnotationOracleUnreadable, FileSystem.FileSystem | Path.Path> =>
  Effect.map(fixtureAnnotationsOf(input), ({ annotations, parseFailures }) => {
    const mutants = reportMutantsOf(input.report)
    const { annotationFailures, mutantsMatched } = annotationTallyOf({
      slice: input.slice,
      annotations,
      mutants,
      parseFailures,
    })
    return { mutantsReported: mutants.length, mutantsMatched, annotationFailures }
  })
