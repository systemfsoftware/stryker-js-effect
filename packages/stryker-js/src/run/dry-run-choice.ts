import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
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
import {
  DryRunCoverageReused,
  dryRunReuse,
  DryRunReuseCommand,
  type DryRunReuseDecision,
} from '../dry-run-reuse.workflow.js'
import { analyzeImportClosure, type ImportClosureAnalysis } from '../import-closure.cell.js'
import { RequireDryRunCommand } from '../require-dry-run.workflow.js'
import { runInputsDigestOf } from '../verdict-semantics.js'
import { incrementalReportTextsOf, priorStatusesOf } from './incremental-reuse.js'
import type { InstrumentDone } from './instrument.cell.js'

export type DryRunTarget = Pick<InstrumentDone, 'project' | 'options'>

const hashOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const coverageOfReportText = (text: string): Option.Option<DryRunCoverage> =>
  Option.flatMap(
    S.decodeOption(S.fromJsonString(ReportedDryRunCoverageSchema))(text),
    (report) => Option.fromNullishOr(report.dryRunCoverage),
  )

export const priorCoveragesOf = (texts: readonly string[]): readonly DryRunCoverage[] =>
  Arr.getSomes(texts.map(coverageOfReportText))

export interface RequireDryRunInput {
  readonly options: Options.StrykerOptions
  readonly mutants: readonly Pick<Mutant.Mutant, 'id' | 'static'>[]
  readonly texts: readonly string[]
}

export const requireDryRunCommandOf = ({ options, mutants, texts }: RequireDryRunInput): RequireDryRunCommand =>
  RequireDryRunCommand.make({
    dryRunOnly: options.dryRunOnly,
    ignoreStatic: options.ignoreStatic,
    hasCheckers: options.checkers.length > 0,
    mutants: mutants.map((mutant) => ({ id: mutant.id, static: mutant.static === true })),
    priorStatuses: priorStatusesOf(texts),
    priorFlakyMutantIds: Arr.dedupe(priorCoveragesOf(texts).flatMap((coverage) => coverage.flakyMutantIds)),
  })

const closureDigestOf = (analysis: ImportClosureAnalysis): string =>
  hashOf(
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
  candidates: readonly DryRunCoverage[],
  currentTestClosureDigest: Option.Option<string>,
  runInputsDigest: string,
  force: boolean,
): PriorChoice => {
  const attempts = candidates.map((coverage): PriorChoice => ({
    prior: Option.some(coverage),
    decision: decisionOfCoverage(Option.some(coverage), currentTestClosureDigest, runInputsDigest, force),
  }))
  return Option.getOrElse(
    Arr.findFirst(attempts, (attempt) => S.is(DryRunCoverageReused)(attempt.decision)),
    () =>
      Option.getOrElse(
        Arr.head(attempts),
        (): PriorChoice => ({
          prior: Option.none(),
          decision: decisionOfCoverage(Option.none(), currentTestClosureDigest, runInputsDigest, force),
        }),
      ),
  )
}

export interface DryRunChoice extends PriorChoice {
  readonly candidates: readonly DryRunCoverage[]
  readonly currentTestClosureDigest: Option.Option<string>
  readonly runInputsDigest: string
}

export const dryRunChoiceOf = Effect.fnUntraced(function*(target: DryRunTarget, basePath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const texts = yield* incrementalReportTextsOf({ basePath, options: target.options })
  const candidates = priorCoveragesOf(texts)
  const runInputsDigest = yield* runInputsDigestOf(fs, path, basePath, target.options)
  const currentTestClosureDigest = yield* testClosureDigestOf(
    target,
    basePath,
    globalInputsOfCoverage(Arr.head(candidates)),
    observedModulesOfCoverage(Arr.head(candidates)),
  )
  const choice = priorChoiceOf(candidates, currentTestClosureDigest, runInputsDigest, target.options.force)
  return { ...choice, candidates, currentTestClosureDigest, runInputsDigest } satisfies DryRunChoice
})
