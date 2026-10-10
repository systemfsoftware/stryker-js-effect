import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type MergedCatalog, MergedCatalogSchema } from './plan-mutator-catalogs.workflow.js'

export class DecodeMutatorSelectionCommand extends S.TaggedClass<DecodeMutatorSelectionCommand>()(
  'DecodeMutatorSelectionCommand',
  {
    catalogs: S.Array(MergedCatalogSchema),
    excludedMutations: S.Array(S.String),
    optInMutations: S.Array(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MutatorSelectionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutatorSelection')
type MutatorSelectionTypeId = typeof MutatorSelectionTypeId

export class MutatorSelectionDecoded extends S.TaggedClass<MutatorSelectionDecoded>()('MutatorSelectionDecoded', {
  excludedMutations: S.Array(S.String),
  optInMutations: S.Array(S.String),
}) {
  readonly [MutatorSelectionTypeId] = MutatorSelectionTypeId
}

export class MutatorSelectionRefused extends S.TaggedError<MutatorSelectionRefused>()('MutatorSelectionRefused', {
  reason: S.Literals(['UnknownName', 'NotOptInTier']),
  name: S.String,
}) {
  override get message(): string {
    return Match.value(this.reason).pipe(
      Match.when(
        'UnknownName',
        () => `Refused the mutator selection: no loaded catalog declares a mutator named "${this.name}".`,
      ),
      Match.when(
        'NotOptInTier',
        () =>
          `Refused the mutator selection: "${this.name}" is a default-tier mutator, and only an opt-in entry may be named by optInMutations.`,
      ),
      Match.exhaustive,
    )
  }
}

interface CatalogIndex {
  readonly declared: readonly string[]
  readonly optIn: readonly string[]
}

const indexOf = (catalogs: readonly MergedCatalog[]): CatalogIndex => ({
  declared: catalogs.flatMap((catalog) => catalog.entries.map((entry) => entry.name)),
  optIn: catalogs.flatMap((catalog) =>
    catalog.entries.filter((entry) => entry.tier === 'optIn').map((entry) => entry.name)
  ),
})

const refusedNameIn = (accepted: readonly string[], names: readonly string[]): Option.Option<string> => {
  const acceptsName = S.is(S.Literals(accepted))
  return Option.fromNullishOr(names.find((name) => !acceptsName(name)))
}

const reasonFor = (index: CatalogIndex, name: string): MutatorSelectionRefused['reason'] =>
  Boolean.match(index.declared.includes(name), {
    onTrue: (): MutatorSelectionRefused['reason'] => 'NotOptInTier',
    onFalse: (): MutatorSelectionRefused['reason'] => 'UnknownName',
  })

const excludedRefusalOf = (
  index: CatalogIndex,
  command: DecodeMutatorSelectionCommand,
): Result.Result<void, MutatorSelectionRefused> =>
  Option.match(refusedNameIn(index.declared, command.excludedMutations), {
    onNone: () => Result.succeed(undefined),
    onSome: (name) => Result.fail(MutatorSelectionRefused.make({ reason: 'UnknownName', name })),
  })

const optInRefusalOf = (
  index: CatalogIndex,
  command: DecodeMutatorSelectionCommand,
): Result.Result<void, MutatorSelectionRefused> =>
  Option.match(refusedNameIn(index.optIn, command.optInMutations), {
    onNone: () => Result.succeed(undefined),
    onSome: (name) => Result.fail(MutatorSelectionRefused.make({ reason: reasonFor(index, name), name })),
  })

const decide = (
  command: DecodeMutatorSelectionCommand,
): Result.Result<MutatorSelectionDecoded, MutatorSelectionRefused> => {
  const index = indexOf(command.catalogs)
  return Result.map(
    Result.flatMap(excludedRefusalOf(index, command), () => optInRefusalOf(index, command)),
    () =>
      MutatorSelectionDecoded.make({
        excludedMutations: [...command.excludedMutations],
        optInMutations: [...command.optInMutations],
      }),
  )
}

export const decodeMutatorSelection = Workflow.make({
  command: DecodeMutatorSelectionCommand,
  decision: MutatorSelectionDecoded,
  error: MutatorSelectionRefused,
  decide,
})
