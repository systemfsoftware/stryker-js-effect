import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

export const requestedIdsOf = (
  options: Options.StrykerOptions & { readonly mutantIds?: ReadonlyArray<string> },
): Option.Option<ReadonlyArray<string>> => Option.fromUndefinedOr(options.mutantIds)

export const restrictedToRequestedIds = ({ mutants, requested }: {
  readonly mutants: readonly Mutant.Mutant[]
  readonly requested: Option.Option<ReadonlyArray<string>>
}): readonly Mutant.Mutant[] =>
  Option.match(requested, {
    onNone: () => mutants,
    onSome: (ids) => mutants.filter((mutant) => ids.includes(mutant.id)),
  })

const killedByOf = (result: Mutant.RunMutantResult): string | null =>
  Option.fromUndefinedOr(result.killedBy).pipe(
    Option.getOrElse(() => []),
    Arr.head,
    Option.getOrNull,
  )

const detailEventOf = (result: Mutant.RunMutantResult): RunEvent.MutantDetailReported =>
  RunEvent.MutantDetailReported.make({
    id: result.id,
    status: result.status,
    coveringTests: [...Option.getOrElse(Option.fromUndefinedOr(result.coveredBy), () => [])],
    killedBy: killedByOf(result),
    reproducer: `stryker run --mutant ${result.id}`,
  })

export const mutantDetailEventsOf = ({ requested, results }: {
  readonly requested: Option.Option<ReadonlyArray<string>>
  readonly results: readonly Mutant.RunMutantResult[]
}): ReadonlyArray<RunEvent.MutantDetailReported> =>
  Option.match(requested, {
    onNone: () => [],
    onSome: (ids) =>
      Arr.getSomes(
        Arr.map(ids, (id) => Option.map(Arr.findFirst(results, (candidate) => candidate.id === id), detailEventOf)),
      ),
  })
