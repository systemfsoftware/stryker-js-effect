import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

const ReuseTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/ReuseCachedVerdicts')
type ReuseTypeId = typeof ReuseTypeId

export class VerdictCacheIdentity extends S.Class<VerdictCacheIdentity>('VerdictCacheIdentity')({
  schemaVersion: S.Literal(1),
  bundleHash: S.String,
  programDigest: S.String,
  wires: S.Array(Checker.CheckerMutantWire),
}) {}

export class ReuseCachedVerdictsCommand
  extends S.TaggedClass<ReuseCachedVerdictsCommand>()('ReuseCachedVerdictsCommand', {
    readCache: S.Boolean,
    current: VerdictCacheIdentity,
    stored: S.NullOr(VerdictCacheIdentity),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class VerdictsReused extends S.TaggedClass<VerdictsReused>()('VerdictsReused', {}) {
  readonly [ReuseTypeId] = ReuseTypeId
}

export const FreshReason = S.Literals([
  'push-refreshes-cache',
  'no-cached-verdicts',
  'bundle-changed',
  'program-changed',
  'mutants-changed',
])
export type FreshReason = typeof FreshReason.Type

export class CheckFreshly extends S.TaggedClass<CheckFreshly>()('CheckFreshly', { reason: FreshReason }) {
  readonly [ReuseTypeId] = ReuseTypeId
}

export const VerdictReuse = S.Union([VerdictsReused, CheckFreshly])
export type VerdictReuse = typeof VerdictReuse.Type

const wireKey = ({ id, fileName, mutatorName, replacement, location }: Checker.CheckerMutantWire): string =>
  [
    id,
    fileName,
    mutatorName,
    replacement,
    location.start.line,
    location.start.column,
    location.end.line,
    location.end.column,
  ].join('\u0000')

const byContent: Order.Order<Checker.CheckerMutantWire> = Order.mapInput(Str.Order, wireKey)
const sameWires = S.toEquivalence(S.Array(Checker.CheckerMutantWire))

const changesAgainst = (
  current: VerdictCacheIdentity,
  stored: VerdictCacheIdentity,
): ReadonlyArray<readonly [FreshReason, boolean]> => [
  ['bundle-changed', stored.bundleHash !== current.bundleHash],
  ['program-changed', stored.programDigest !== current.programDigest],
  ['mutants-changed', !sameWires(Arr.sort(stored.wires, byContent), Arr.sort(current.wires, byContent))],
]

const storedChanges = (command: ReuseCachedVerdictsCommand): ReadonlyArray<readonly [FreshReason, boolean]> =>
  Option.match(Option.fromNullishOr(command.stored), {
    onNone: () => [['no-cached-verdicts', true] as const],
    onSome: (stored) => changesAgainst(command.current, stored),
  })

const reuseOf = (command: ReuseCachedVerdictsCommand): VerdictReuse =>
  Option.match(
    Arr.findFirst(
      [['push-refreshes-cache', !command.readCache] as const, ...storedChanges(command)],
      ([, changed]) => changed,
    ),
    {
      onNone: () => VerdictsReused.make({}),
      onSome: ([reason]) => CheckFreshly.make({ reason }),
    },
  )

export const reuseCachedVerdicts = Workflow.make({
  command: ReuseCachedVerdictsCommand,
  decision: VerdictReuse,
  error: S.Never,
  decide: (command: ReuseCachedVerdictsCommand): Result.Result<VerdictReuse, never> => Result.succeed(reuseOf(command)),
})
