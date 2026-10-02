import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Metric from 'effect/Metric'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { checkerMutantsSkipped } from '../Checker/Checker.handle.js'
import { CheckerMutantFromMutant } from '../Checker/Checker.schema.js'
import { RunFailure } from '../Run.schema.js'
import { sandboxFileFor, type SandboxHandle } from '../Sandbox.handle.js'

export const isMutantStatus = S.is(Mutant.MutantStatusSchema)
export type ValidMutantStatus = Mutant.MutantStatus

export const toReportedMutant = (mutant: Mutant.Mutant): Mutant.MutantTestCoverage =>
  Object.assign(mutant, { coveredBy: mutant.coveredBy, static: mutant.static })

export interface PlannedResults {
  readonly planned: readonly Mutant.Mutant[]
  readonly results: readonly Mutant.RunMutantResult[]
}

export const inPlannedOrder = ({ planned, results }: PlannedResults): readonly Mutant.RunMutantResult[] => {
  const rankById: Readonly<Record<string, number>> = Object.fromEntries(
    planned.map((mutant, index) => [mutant.id, index] as const),
  )
  return Arr.sortWith(results, (result) => rankById[result.id] ?? planned.length, Order.Number)
}

const sandboxFilePairsOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Result.all(
    fileNames.map((fileName) =>
      Result.map(
        sandboxFileFor(sandbox, fileName),
        (sandboxFileName): readonly [string, string] => [fileName, sandboxFileName],
      )
    ),
  )

export interface SandboxFilesInput {
  readonly sandbox: SandboxHandle
  readonly fileNames: readonly string[]
}

export const sandboxFilesOf: (
  input: SandboxFilesInput,
) => Effect.Effect<readonly (readonly [string, string])[], RunFailure> = Effect.fn(
  SpanTaxonomy.Spans.mutationTestSandboxFiles.name,
)(function*(input: SandboxFilesInput) {
  return yield* Effect.fromResult(sandboxFilePairsOf(input.sandbox, input.fileNames)).pipe(
    Effect.mapError((cause) =>
      RunFailure.make({
        evidence: { _tag: 'SandboxPreparationFailed', stage: 'mutationTest' },
        detail: 'Failed to resolve sandbox file',
        cause,
      })
    ),
  )
})

export const configuredTestFilesOf = (run: {
  readonly options: { readonly testFiles: readonly string[] }
  readonly project: { readonly testFiles: readonly string[] }
}): readonly string[] => run.options.testFiles.length === 0 ? [] : run.project.testFiles

const isPlannable = (mutant: Mutant.Mutant): boolean =>
  Result.isSuccess(S.decodeResult(CheckerMutantFromMutant)(mutant))

const DROPPED_IDS_IN_WARNING = 5

export const partitionPlannable = (mutants: readonly Mutant.Mutant[]) => ({
  plannable: mutants.filter(isPlannable),
  dropped: mutants.filter((candidate) => !isPlannable(candidate)),
})

const droppedIdsOf = (dropped: readonly Mutant.Mutant[]): string =>
  `${dropped.slice(0, DROPPED_IDS_IN_WARNING).map((mutant) => mutant.id).join(', ')}${
    Option.match(Option.liftPredicate(dropped.length, (count) => count > DROPPED_IDS_IN_WARNING), {
      onNone: () => '',
      onSome: (count) => `, +${count - DROPPED_IDS_IN_WARNING} more`,
    })
  }`

export const reportDroppedMutants = (dropped: readonly Mutant.Mutant[]) =>
  Option.match(Option.liftPredicate(dropped, (candidates) => candidates.length > 0), {
    onNone: () => Effect.void,
    onSome: (candidates) =>
      Effect.gen(function*() {
        yield* Metric.update(checkerMutantsSkipped, candidates.length)
        yield* Effect.logWarning(
          `${candidates.length} mutant(s) cannot be described to a checker and were left out of the run (${
            droppedIdsOf(candidates)
          })`,
        )
      }),
  })
