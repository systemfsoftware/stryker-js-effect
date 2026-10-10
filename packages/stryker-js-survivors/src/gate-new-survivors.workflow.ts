import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Baseline, BaselineSchemaVersion } from './Baseline.schema.js'

export const GateEntry = S.Struct({
  id: Mutant.MutantId,
  fileName: S.String,
  line: Mutant.Line,
  status: Mutant.MutantStatusSchema,
})

export type GateEntry = typeof GateEntry.Type

const GATE_EXIT_CLASS = 'VerdictFail' satisfies Plugin.ExitClass
const GATE_REMEDIATION = 'kill the new survivors, or accept them with `stryker gate --update-baseline`'

/**
 * R28: `Survived` and `NoCoverage` are survivors; a `Timeout` or a runtime
 * error is not. Written out here rather than read off `SurvivedStatusSchema`
 * because a decision may only import the schema file of the type it operates
 * on - the workflow purity gate refuses a reference to any other module.
 */
const SurvivorStatuses = S.Literals(['Survived', 'NoCoverage'])

const idOrder: Order.Order<GateEntry> = Order.mapInput(Order.String, (entry) => entry.id)

const GateNewSurvivorsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/GateNewSurvivorsDecision')
type GateNewSurvivorsTypeId = typeof GateNewSurvivorsTypeId

export class GateCleared extends S.TaggedClass<GateCleared>()('GateCleared', {
  baseline: S.NullOr(Baseline),
  unchecked: Mutant.MutantId.pipe(S.Array),
}) {
  readonly [GateNewSurvivorsTypeId] = GateNewSurvivorsTypeId
}

export const GateNewSurvivorsDecision = S.Union([GateCleared])
export type GateNewSurvivorsDecision = typeof GateNewSurvivorsDecision.Type

export class GateNewSurvivorsCommand extends S.TaggedClass<GateNewSurvivorsCommand>()('GateNewSurvivorsCommand', {
  entries: S.Array(GateEntry),
  committed: Mutant.MutantId.pipe(S.Array, S.NullOr),
  baselineFile: S.String,
  updateBaseline: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class GateRejected extends S.TaggedError<GateRejected>()('GateRejected', {
  newSurvivors: S.Array(GateEntry),
  unchecked: Mutant.MutantId.pipe(S.Array),
}) {
  readonly exitClass = GATE_EXIT_CLASS

  override get message(): string {
    return [
      `stryker gate: ${this.newSurvivors.length} new survivor(s) absent from the committed baseline:`,
      ...this.newSurvivors.map((entry) => `  ${entry.fileName}:${entry.line} ${entry.id}`),
      ...Option.match(Option.liftPredicate(this.unchecked, (unchecked) => unchecked.length > 0), {
        onNone: (): ReadonlyArray<string> => [],
        onSome: (unchecked) => [`${unchecked.length} mutant(s) unchecked`],
      }),
      GATE_REMEDIATION,
    ].join('\n')
  }
}

export class GateInputUnusable extends S.TaggedError<GateInputUnusable>()('GateInputUnusable', {
  reason: S.String,
}) {
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass

  override get message(): string {
    return `stryker gate: ${this.reason}`
  }
}

const isSurvivor = (entry: GateEntry): boolean => S.is(SurvivorStatuses)(entry.status)
const isUnchecked = (entry: GateEntry): boolean => entry.status === 'Pending'

const sortedIdsOf = (entries: ReadonlyArray<GateEntry>): ReadonlyArray<Mutant.MutantId> =>
  Arr.sort(
    Arr.map(entries, (entry) => entry.id),
    Order.String,
  )

const survivorIdsOf = (entries: ReadonlyArray<GateEntry>): ReadonlyArray<Mutant.MutantId> =>
  sortedIdsOf(Arr.filter(entries, isSurvivor))

const uncheckedIdsOf = (entries: ReadonlyArray<GateEntry>): ReadonlyArray<Mutant.MutantId> =>
  sortedIdsOf(Arr.filter(entries, isUnchecked))

const newSurvivorsOf = (
  entries: ReadonlyArray<GateEntry>,
  committed: ReadonlyArray<Mutant.MutantId>,
): ReadonlyArray<GateEntry> => {
  const known = HashSet.fromIterable(committed)
  return Arr.filter(
    Arr.sort(Arr.filter(entries, isSurvivor), idOrder),
    (entry) => !HashSet.has(known, entry.id),
  )
}

const clearedForUpdate = (command: GateNewSurvivorsCommand): GateCleared =>
  GateCleared.make({
    baseline: Baseline.make({
      schemaVersion: BaselineSchemaVersion.literal,
      survivors: survivorIdsOf(command.entries),
    }),
    unchecked: uncheckedIdsOf(command.entries),
  })

const baselineUnusable = (baselineFile: string): GateInputUnusable =>
  GateInputUnusable.make({
    reason:
      `no usable committed baseline at ${baselineFile} (missing or undecodable); write one with \`stryker gate --update-baseline\``,
  })

const clearedOrRejected = (
  command: GateNewSurvivorsCommand,
  committed: ReadonlyArray<Mutant.MutantId>,
): Result.Result<GateCleared, GateRejected> => {
  const unchecked = uncheckedIdsOf(command.entries)
  const newSurvivors = newSurvivorsOf(command.entries, committed)
  return Option.match(Arr.head(newSurvivors), {
    onNone: () => Result.succeed(GateCleared.make({ baseline: null, unchecked })),
    onSome: () => Result.fail(GateRejected.make({ newSurvivors, unchecked })),
  })
}

const verdictOf = (
  command: GateNewSurvivorsCommand,
): Result.Result<GateCleared, GateRejected | GateInputUnusable> =>
  Option.match(Option.fromNullishOr(command.committed), {
    onNone: () => Result.fail(baselineUnusable(command.baselineFile)),
    onSome: (committed) => clearedOrRejected(command, committed),
  })

const decide = (
  command: GateNewSurvivorsCommand,
): Result.Result<GateNewSurvivorsDecision, GateRejected | GateInputUnusable> =>
  Boolean.match(command.updateBaseline, {
    onTrue: () => Result.succeed(clearedForUpdate(command)),
    onFalse: () => verdictOf(command),
  })

export const gateNewSurvivors = Workflow.make({
  command: GateNewSurvivorsCommand,
  decision: GateNewSurvivorsDecision,
  error: S.Union([GateRejected, GateInputUnusable]),
  decide,
})
