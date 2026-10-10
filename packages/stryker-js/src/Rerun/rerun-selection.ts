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

export const requestedResultsOf = ({ requested, results }: {
  readonly requested: Option.Option<ReadonlyArray<string>>
  readonly results: readonly Mutant.RunMutantResult[]
}): readonly Mutant.RunMutantResult[] =>
  Option.match(requested, {
    onNone: () => [],
    onSome: (ids) => Arr.getSomes(Arr.map(ids, (id) => Arr.findFirst(results, (candidate) => candidate.id === id))),
  })
