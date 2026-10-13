import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  dryRunCandidates,
  DryRunCandidatesCommand,
  type DryRunCandidatesDecision,
} from '../dry-run-candidates.workflow.js'
import {
  type CoverageRoot,
  type DryRunCoverage,
  type DryRunReusePrior,
  ReportedDryRunCoverageSchema,
} from '../dry-run-coverage.schema.js'
import {
  DryRunCoverageReused,
  dryRunReuse,
  DryRunReuseCommand,
  type DryRunReuseDecision,
} from '../dry-run-reuse.workflow.js'
import { analyzeImportClosure, type ImportClosureAnalysis } from '../import-closure.cell.js'
import { RequireDryRunCommand } from '../require-dry-run.workflow.js'
import { runInputsDigestOf } from '../verdict-semantics.js'
import { priorStatusesOf } from './incremental-reuse.js'
import type { InstrumentDone } from './instrument.cell.js'

export type DryRunTarget = Pick<InstrumentDone, 'project' | 'options'>

const hashOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const coverageOfReportText = (text: string): Option.Option<DryRunCoverage> =>
  Option.flatMap(
    S.decodeOption(S.fromJsonString(ReportedDryRunCoverageSchema))(text),
    (report) => Option.fromNullishOr(report.dryRunCoverage),
  )

const priorCoveragesOf = (texts: readonly string[]): readonly DryRunCoverage[] =>
  Arr.getSomes(texts.map(coverageOfReportText))

export interface RequireDryRunInput {
  readonly options: Options.StrykerOptions
  readonly mutants: readonly Pick<Mutant.Mutant, 'id' | 'static'>[]
  readonly texts: readonly string[]
  readonly kept: readonly DryRunCoverage[]
}

export const requireDryRunCommandOf = ({ options, mutants, texts, kept }: RequireDryRunInput): RequireDryRunCommand =>
  RequireDryRunCommand.make({
    dryRunOnly: options.dryRunOnly,
    ignoreStatic: options.ignoreStatic,
    hasCheckers: options.checkers.length > 0,
    mutants: mutants.map((mutant) => ({ id: mutant.id, static: mutant.static === true })),
    priorStatuses: priorStatusesOf(texts),
    priorFlakyMutantIds: Arr.dedupe(kept.flatMap((coverage) => coverage.flakyMutantIds)),
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
      projectFiles: Arr.dedupe([...target.project.files.keys(), ...target.project.testFiles]),
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

const decisionOfPrior = (
  prior: DryRunReusePrior,
  currentTestClosureDigest: Option.Option<string>,
  runInputsDigest: string,
  force: boolean,
): DryRunReuseDecision =>
  Result.getOrElse(
    dryRunReuse(
      DryRunReuseCommand.make({
        prior,
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
  kept: readonly DryRunCoverage[],
  fallback: DryRunReusePrior,
  currentTestClosureDigest: Option.Option<string>,
  runInputsDigest: string,
  force: boolean,
): PriorChoice => {
  const attempts = kept.map((coverage): PriorChoice => ({
    prior: Option.some(coverage),
    decision: decisionOfPrior(
      {
        _tag: 'PriorUnderCurrentRoot',
        testClosureDigest: coverage.testClosureDigest,
        runInputsDigest: coverage.runInputsDigest,
      },
      currentTestClosureDigest,
      runInputsDigest,
      force,
    ),
  }))
  return Option.getOrElse(
    Arr.findFirst(attempts, (attempt) => S.is(DryRunCoverageReused)(attempt.decision)),
    () =>
      Option.getOrElse(
        Arr.head(attempts),
        (): PriorChoice => ({
          prior: Option.none(),
          decision: decisionOfPrior(fallback, currentTestClosureDigest, runInputsDigest, force),
        }),
      ),
  )
}

const coverageRootOf = (coverage: DryRunCoverage): CoverageRoot =>
  Option.match(Option.fromUndefinedOr(coverage.projectRoot), {
    onNone: (): CoverageRoot => ({ _tag: 'UnrecordedRoot' }),
    onSome: (path): CoverageRoot => ({ _tag: 'RecordedRoot', path }),
  })

const candidatesDecisionOf = (
  currentRoot: string,
  candidates: readonly DryRunCoverage[],
): DryRunCandidatesDecision =>
  Result.getOrElse(
    dryRunCandidates(DryRunCandidatesCommand.make({ currentRoot, candidates: candidates.map(coverageRootOf) })),
    (never: never) => never,
  )

const keptCoveragesOf = (
  decision: DryRunCandidatesDecision,
  candidates: readonly DryRunCoverage[],
): readonly DryRunCoverage[] =>
  Match.value(decision).pipe(
    Match.tag('CandidatesKept', ({ indices }) => Arr.getSomes(indices.map((index) => Arr.get(candidates, index)))),
    Match.orElse((): readonly DryRunCoverage[] => []),
  )

const fallbackPriorOf = (decision: DryRunCandidatesDecision): DryRunReusePrior =>
  Match.value(decision).pipe(
    Match.tag('CandidatesUnderOtherRoots', (): DryRunReusePrior => ({ _tag: 'PriorUnderOtherRoots' })),
    Match.tag('CandidatesUnrecorded', (): DryRunReusePrior => ({ _tag: 'PriorRootUnrecorded' })),
    Match.orElse((): DryRunReusePrior => ({ _tag: 'NoPriorCoverage' })),
  )

export interface CurrentRootCoverages {
  readonly candidates: readonly DryRunCoverage[]
  readonly kept: readonly DryRunCoverage[]
  readonly candidatesDecision: DryRunCandidatesDecision
  readonly currentRoot: string
}

export const currentRootCoveragesOf = Effect.fnUntraced(function*(texts: readonly string[], basePath: string) {
  const path = yield* Path.Path
  const currentRoot = path.resolve(basePath)
  const candidates = priorCoveragesOf(texts)
  const candidatesDecision = candidatesDecisionOf(currentRoot, candidates)
  return {
    candidates,
    kept: keptCoveragesOf(candidatesDecision, candidates),
    candidatesDecision,
    currentRoot,
  } satisfies CurrentRootCoverages
})

export interface DryRunChoice extends PriorChoice, CurrentRootCoverages {
  readonly currentTestClosureDigest: Option.Option<string>
  readonly runInputsDigest: string
}

export const dryRunChoiceOf = Effect.fnUntraced(function*(
  target: DryRunTarget,
  basePath: string,
  texts: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const coverages = yield* currentRootCoveragesOf(texts, basePath)
  const runInputsDigest = yield* runInputsDigestOf(fs, path, basePath, target.options)
  const currentTestClosureDigest = yield* testClosureDigestOf(
    target,
    basePath,
    globalInputsOfCoverage(Arr.head(coverages.kept)),
    observedModulesOfCoverage(Arr.head(coverages.kept)),
  )
  const choice = priorChoiceOf(
    coverages.kept,
    fallbackPriorOf(coverages.candidatesDecision),
    currentTestClosureDigest,
    runInputsDigest,
    target.options.force,
  )
  return { ...choice, ...coverages, currentTestClosureDigest, runInputsDigest } satisfies DryRunChoice
})
