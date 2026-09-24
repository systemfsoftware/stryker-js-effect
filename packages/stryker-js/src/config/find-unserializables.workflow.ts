import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const UnserializableDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/UnserializableDecision',
)
type UnserializableDecisionTypeId = typeof UnserializableDecisionTypeId

export class OptionsSerializable extends S.TaggedClass<OptionsSerializable>()('OptionsSerializable', {}) {
  readonly [UnserializableDecisionTypeId] = UnserializableDecisionTypeId
}

export class OptionsUnserializable extends S.TaggedClass<OptionsUnserializable>()('OptionsUnserializable', {
  descriptions: S.Array(UnserializableDescription),
}) {
  readonly [UnserializableDecisionTypeId] = UnserializableDecisionTypeId
}

export type UnserializableDecision = OptionsSerializable | OptionsUnserializable

export class FindUnserializablesCommand extends S.TaggedClass<FindUnserializablesCommand>()(
  'FindUnserializablesCommand',
  {
    options: S.Record(S.String, S.Unknown),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

/** The serialization defects one options value can carry: where, and why. */
export const UnserializableDescription = S.Struct({
  path: S.Array(S.String),
  reason: S.String,
})
export type UnserializableDescription = typeof UnserializableDescription.Type

const NON_JSON_PRIMITIVE_TYPES: ReadonlyRecord<string, true> = {
  bigint: true,
  function: true,
  symbol: true,
}

const scoped =
  (scope: string) =>
  (description: UnserializableDescription): UnserializableDescription => ({
    ...description,
    path: [scope, ...description.path],
  })

const childDescriptions = (entries: ReadonlyArray<readonly [string, S.Unknown.Type]>): UnserializableDescription[] =>
  entries.flatMap(([scope, child]) => describeOptionsValue(child).map(scoped(scope)))

const describedNonJsonPrimitive = (value: S.Unknown.Type): UnserializableDescription[] => [
  {
    path: [],
    reason: `Primitive type "${typeof value}" has no JSON representation`,
  },
]

const describedArray = (value: ReadonlyArray<S.Unknown.Type>): UnserializableDescription[] =>
  childDescriptions(value.map((child, index) => [index.toString(), child] as const))
const describeObject = (value: object): UnserializableDescription[] =>
  Match.value(Array.isArray(value)).pipe(
    Match.when(true, (arrayed) => describedArray(arrayed)),
    Match.orElse((recorded) => describeRecordValue(recorded)),
  )

const describeRecordValue = (value: object): UnserializableDescription[] =>
  Match.value(value.constructor === Object).pipe(
    Match.when(true, (plain) => describedRecord(plain)),
    Match.orElse((instance) => describedInstance(instance)),
  )


const describeNonNumber = (value: S.Unknown.Type): UnserializableDescription[] =>
  Match.value(NON_JSON_PRIMITIVE_TYPES[typeof value] === true).pipe(
    Match.when(true, () => describedNonJsonPrimitive(value)),
    Match.orElse(() => describeNonNullObject(value)),
  )

const describeOptionsValue = (value: S.Unknown.Type): UnserializableDescription[] =>
  Match.value(Number.isFinite(value)).pipe(
    Match.when(true, (): UnserializableDescription[] => []),
    Match.orElse((): UnserializableDescription[] =>
      Match.value(typeof value === 'number').pipe(
        Match.when(true, (whole: number | boolean | string | object | null) => describedInfiniteNumber(whole)),
        Match.orElse(() => describeNonNumber(value)),
      )),
  )

const decide = (command: FindUnserializablesCommand): Result.Result<UnserializableDecision, never> =>
  Option.match(Option.liftPredicate(describeOptionsValue(command.options), (found) => found.length === 0), {
    onNone: (descriptions) => Result.succeed(OptionsUnserializable.make({ descriptions })),
    onSome: () => Result.succeed(OptionsSerializable.make({})),
  })

export const findUnserializables = Workflow.make({
  command: FindUnserializablesCommand,
  decision: S.Union([OptionsSerializable, OptionsUnserializable]),
  error: S.Never,
  decide,
})
