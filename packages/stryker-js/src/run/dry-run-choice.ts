import type { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type DryRunCoverage, ReportedDryRunCoverageSchema } from '../dry-run-coverage.schema.js'
import { dryRunReuse, DryRunReuseCommand, type DryRunReuseDecision } from '../dry-run-reuse.workflow.js'
import { analyzeImportClosure, type ImportClosureAnalysis } from '../import-closure.cell.js'
import { RequireDryRunCommand } from '../require-dry-run.workflow.js'
import { runInputsDigestOf, sha256HexOf } from '../verdict-semantics.js'
import type { VerdictEntry } from '../verdict-store/VerdictEntry.schema.js'
import { incrementalReportTextOf } from './incremental-reuse.js'
import type { InstrumentDone } from './instrument.cell.js'

export type DryRunTarget = Pick<InstrumentDone, 'project' | 'options'>

const coverageOfReportText = (text: string): Option.Option<DryRunCoverage> =>
  Option.flatMap(
    S.decodeOption(S.fromJsonString(ReportedDryRunCoverageSchema))(text),
    (report) => Option.fromNullishOr(report.dryRunCoverage),
  )

export interface RequireDryRunInput {
  readonly options: Options.StrykerOptions
  readonly mutants: readonly Pick<Mutant.Mutant, 'id' | 'static'>[]
  readonly text: string
  readonly priorEntries: ReadonlyArray<VerdictEntry>
}

export const requireDryRunCommandOf = (
  { options, mutants, text, priorEntries }: RequireDryRunInput,
): RequireDryRunCommand =>
  RequireDryRunCommand.make({
    dryRunOnly: options.dryRunOnly,
    ignoreStatic: options.ignoreStatic,
    hasCheckers: options.checkers.length > 0,
    mutants: mutants.map((mutant) => ({ id: mutant.id, static: mutant.static === true })),
    priorStatuses: priorEntries.map((entry) => ({ mutantId: entry.components.mutantId, status: entry.status })),
    priorFlakyMutantIds: Arr.dedupe(
      Option.match(coverageOfReportText(text), {
        onNone: (): readonly string[] => [],
        onSome: (coverage) => coverage.flakyMutantIds,
      }),
    ),
  })

const closureDigestOf = (analysis: ImportClosureAnalysis): string =>
  sha256HexOf(
    [
      ...analysis.closures.map((closure) => `${closure.testFile}\u0000${closure.digest}`).sort(),
      analysis.projectDigest,
    ].join('\n'),
  )

const closureDigestOptionOf = (analysis: Option.Option<ImportClosureAnalysis>): Option.Option<string> =>
  Option.map(analysis, closureDigestOf)

export const testClosureDigestOf = Effect.fnUntraced(function*(
  target: DryRunTarget,
  rootDir: string,
  globalInputs: readonly string[],
  observedModules: Readonly<Record<string, readonly string[]>> | undefined,
) {
  const analysis = yield* Effect.option(
    analyzeImportClosure({
      rootDir,
      projectFiles: Arr.dedupe([...MutableHashMap.keys(target.project.files), ...target.project.testFiles]),
      testFiles: [...target.project.testFiles],
      globalInputs: [...globalInputs],
      ...(observedModules === undefined ? {} : { observedModules }),
    }),
  )
  return closureDigestOptionOf(analysis)
})

const globalInputsOfCoverage = (coverage: Option.Option<DryRunCoverage>): readonly string[] =>
  Option.getOrElse(Option.map(coverage, (present) => [...present.globalTestInputs]), () => [])

const observedModulesOfCoverage = (
  coverage: Option.Option<DryRunCoverage>,
): Readonly<Record<string, readonly string[]>> | undefined =>
  Option.getOrUndefined(Option.flatMap(coverage, (present) => Option.fromUndefinedOr(present.testFileModules)))

const decisionOfCoverage = (
  prior: Option.Option<DryRunCoverage>,
  currentTestClosureDigest: Option.Option<string>,
  runInputsDigest: string,
  force: boolean,
): DryRunReuseDecision =>
  Result.getOrElse(
    dryRunReuse(
      DryRunReuseCommand.make({
        prior: Option.getOrUndefined(
          Option.map(prior, (coverage) => ({
            testClosureDigest: coverage.testClosureDigest,
            runInputsDigest: coverage.runInputsDigest,
          })),
        ),
        currentTestClosureDigest: Option.getOrUndefined(currentTestClosureDigest),
        currentRunInputsDigest: runInputsDigest,
        force,
      }),
    ),
    (never: never) => never,
  )

interface PriorChoice {
  readonly prior: Option.Option<DryRunCoverage>
  readonly decision: DryRunReuseDecision
}

const priorChoiceOf = (
  prior: Option.Option<DryRunCoverage>,
  currentTestClosureDigest: Option.Option<string>,
  runInputsDigest: string,
  force: boolean,
): PriorChoice => ({
  prior,
  decision: decisionOfCoverage(prior, currentTestClosureDigest, runInputsDigest, force),
})

export interface DryRunChoice extends PriorChoice {
  readonly currentTestClosureDigest: Option.Option<string>
  readonly runInputsDigest: string
}

export const dryRunChoiceOf = Effect.fnUntraced(function*(target: DryRunTarget, basePath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const coverage = coverageOfReportText(yield* incrementalReportTextOf({ basePath, options: target.options }))
  const runInputsDigest = yield* runInputsDigestOf(fs, path, basePath, target.options)
  const currentTestClosureDigest = yield* testClosureDigestOf(
    target,
    basePath,
    globalInputsOfCoverage(coverage),
    observedModulesOfCoverage(coverage),
  )
  const choice = priorChoiceOf(coverage, currentTestClosureDigest, runInputsDigest, target.options.force)
  return { ...choice, currentTestClosureDigest, runInputsDigest } satisfies DryRunChoice
})
