import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { ScopeSettings, seededOrder } from './Parity.schema.js'

const SelectScopeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/SelectScope')
type SelectScopeTypeId = typeof SelectScopeTypeId

type Wire = Checker.CheckerMutantWire

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

const fileNameOf = (mutant: Wire): string => mutant.fileName

const mutantsOfFile = (mutants: ReadonlyArray<Wire>, file: string): ReadonlyArray<Wire> =>
  Arr.filter(mutants, (mutant) => fileNameOf(mutant) === file)

const inSeededOrder = (settings: ScopeSettings, wires: ReadonlyArray<Wire>): ReadonlyArray<Wire> => {
  const order = seededOrder(settings, wires.map((wire) => wire.id))
  return Arr.sort(wires, Order.mapInput(Order.Number, (wire: Wire) => order.indexOf(wire.id)))
}

const strataOf = (settings: ScopeSettings, mutants: ReadonlyArray<Wire>): ReadonlyArray<ReadonlyArray<Wire>> =>
  seededOrder(settings, mutants.map((mutant) => mutant.mutatorName)).map((name) =>
    inSeededOrder(settings, mutants.filter((mutant) => mutant.mutatorName === name))
  )

const roundRobin = (strata: ReadonlyArray<ReadonlyArray<Wire>>, target: number): ReadonlyArray<Wire> =>
  Arr.take(
    Arr.flatMap(Arr.range(0, target - 1), (round) =>
      Arr.flatMap(strata, (stratum) => Option.toArray(Option.fromUndefinedOr(stratum[round])))),
    target,
  )

const sampleOf = (settings: ScopeSettings, cap: number, mutants: ReadonlyArray<Wire>): ReadonlyArray<Wire> => {
  const strata = strataOf(settings, mutants)
  const target = Order.min(Order.Number)(cap, mutants.length)
  return Boolean.match(strata.length === 0, {
    onTrue: () => Arr.empty<Wire>(),
    onFalse: () => roundRobin(strata, target),
  })
}

const changedInFiles = (command: SelectScopeCommand): ReadonlyArray<Wire> =>
  Arr.flatMap(
    Arr.dedupe(command.changedFiles),
    (file) => sampleOf(command.settings, command.settings.perChangedFile, mutantsOfFile(command.mutants, file)),
  )

const sampledOf = (command: SelectScopeCommand): ReadonlyArray<Wire> =>
  Option.match(Option.fromNullishOr(command.sampleFile), {
    onNone: () => Arr.empty<Wire>(),
    onSome: (file) => sampleOf(command.settings, command.settings.perProject, mutantsOfFile(command.mutants, file)),
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
