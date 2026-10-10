import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Hash from 'effect/Hash'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { ScopeSettings } from './Parity.schema.js'

const SelectScopeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/SelectScope')
type SelectScopeTypeId = typeof SelectScopeTypeId

type Wire = Checker.CheckerMutantWire
type Stratum = readonly [string, ReadonlyArray<Wire>]

export class SelectScopeCommand extends S.TaggedClass<SelectScopeCommand>()('SelectScopeCommand', {
  changedFiles: S.Array(S.String),
  sampleFile: S.NullOr(S.String),
  mutants: S.Array(Checker.CheckerMutantWire),
  settings: ScopeSettings,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ScopeSelected extends S.TaggedClass<ScopeSelected>()('ScopeSelected', {
  changed: S.Array(Checker.CheckerMutantWire),
  sampled: S.Array(Checker.CheckerMutantWire),
  wires: S.Array(Checker.CheckerMutantWire),
}) {
  readonly [SelectScopeTypeId] = SelectScopeTypeId
}

export class NothingSelected extends S.TaggedClass<NothingSelected>()('NothingSelected', {}) {
  readonly [SelectScopeTypeId] = SelectScopeTypeId
}

export const ScopeDecision = S.Union([ScopeSelected, NothingSelected])
export type ScopeDecision = typeof ScopeDecision.Type

const orderKey = (seed: string) => (value: string): number => Hash.string(`${seed}\u0000${value}`)

const fileNameOf = (mutant: Wire): string => mutant.fileName

const strataEntries = (mutants: ReadonlyArray<Wire>): ReadonlyArray<Stratum> =>
  Object.entries(Arr.groupBy(mutants, (mutant) => mutant.mutatorName))

const mutantsOfFile = (mutants: ReadonlyArray<Wire>, file: string): ReadonlyArray<Wire> =>
  Arr.filter(mutants, (mutant) => fileNameOf(mutant) === file)

const strataOf = (seed: string, mutants: ReadonlyArray<Wire>): ReadonlyArray<ReadonlyArray<Wire>> =>
  Arr.map(
    Arr.sort(
      strataEntries(mutants),
      Order.combine(
        Order.mapInput(Order.Number, ([name]: Stratum) => orderKey(seed)(name)),
        Order.mapInput(Str.Order, ([name]: Stratum) => name),
      ),
    ),
    ([, group]: Stratum) =>
      Arr.sort(
        group,
        Order.combine(
          Order.mapInput(Order.Number, (wire: Wire) => orderKey(seed)(wire.id)),
          Order.mapInput(Str.Order, (wire: Wire) => wire.id),
        ),
      ),
  )

const roundRobin = (strata: ReadonlyArray<ReadonlyArray<Wire>>, target: number): ReadonlyArray<Wire> =>
  Arr.take(
    Arr.flatMap(Arr.range(0, target - 1), (round) =>
      Arr.flatMap(strata, (stratum) => Option.toArray(Option.fromUndefinedOr(stratum[round])))),
    target,
  )

const sampleOf = (seed: string, cap: number, mutants: ReadonlyArray<Wire>): ReadonlyArray<Wire> => {
  const strata = strataOf(seed, mutants)
  const target = Order.min(Order.Number)(cap, mutants.length)
  return Boolean.match(strata.length === 0, {
    onTrue: () => Arr.empty<Wire>(),
    onFalse: () => roundRobin(strata, target),
  })
}

const changedInFiles = (command: SelectScopeCommand): ReadonlyArray<Wire> =>
  Arr.flatMap(
    Arr.dedupe(command.changedFiles),
    (file) => sampleOf(command.settings.seed, command.settings.perChangedFile, mutantsOfFile(command.mutants, file)),
  )

const sampledOf = (command: SelectScopeCommand): ReadonlyArray<Wire> =>
  Option.match(Option.fromNullishOr(command.sampleFile), {
    onNone: () => Arr.empty<Wire>(),
    onSome: (file) =>
      sampleOf(command.settings.seed, command.settings.perProject, mutantsOfFile(command.mutants, file)),
  })

const wiresOf = (changed: ReadonlyArray<Wire>, sampled: ReadonlyArray<Wire>): ReadonlyArray<Wire> =>
  Arr.sort(
    Arr.dedupeWith([...changed, ...sampled], (left, right) => left.id === right.id),
    Order.mapInput(Str.Order, (wire: Wire) => wire.id),
  )

const selectScopeOf = (command: SelectScopeCommand): ScopeDecision => {
  const changed = changedInFiles(command)
  const sampled = sampledOf(command)
  const wires = wiresOf(changed, sampled)
  return Boolean.match(wires.length === 0, {
    onTrue: () => NothingSelected.make({}),
    onFalse: () => ScopeSelected.make({ changed, sampled, wires }),
  })
}

const decide = (command: SelectScopeCommand): Result.Result<ScopeDecision, never> =>
  Result.succeed(selectScopeOf(command))

export const selectScope = Workflow.make({
  command: SelectScopeCommand,
  decision: ScopeDecision,
  error: S.Never,
  decide,
})
