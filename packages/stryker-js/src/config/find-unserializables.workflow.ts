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

export const UnserializableDescription = S.Struct({
  path: S.Array(S.String),
  reason: S.String,
})
export type UnserializableDescription = S.Schema.Type<typeof UnserializableDescription>

const NON_JSON_PRIMITIVE_TYPES: Record<string, true> = {
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

const describedArrayEntries = (
  entries: ReadonlyArray<readonly [string, S.Unknown.Type]>,
): UnserializableDescription[] =>
  entries.flatMap(([scope, child]) => describeOptionsValue(child).map(scoped(scope)))

const describedPrimitives = (value: number): UnserializableDescription[] => [
  {
    path: [],
    reason: `Number value \`${value}\` has no JSON representation`,
  },
]

const describeClassInstance = (value: object): UnserializableDescription[] => [
  {
    path: [],
    reason: `Value is an instance of "${Match.value(value.constructor).pipe(
      Match.when(Match.defined, (ctor) => ctor.name),
      Match.orElse(() => 'Object'),
    )}", this detail will get lost in translation during serialization`,
  },
]

const describeRecordObject = (value: object): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(Option.some(value), (candidate) => candidate.constructor === Object), {
    onNone: () => describeClassInstance(value),
    onSome: (plain) => describedArrayEntries(Object.entries(plain)),
  })

const describeStructuredObject = (value: object): UnserializableDescription[] =>
  Option.match(
    Option.filter(Option.some(value), (candidate): candidate is ReadonlyArray<S.Unknown.Type> =>
      Array.isArray(candidate)),
    {
      onNone: () => describeRecordObject(value),
      onSome: (arrayed) => describeStructuredArray(arrayed),
    },
  )

const describeStructuredArray = (value: ReadonlyArray<S.Unknown.Type>): UnserializableDescription[] =>
  describedArrayEntries(value.map((child, index) => [index.toString(), child] as const))

const describeNonNullish = (value: S.Unknown.Type): UnserializableDescription[] =>
  Match.value(value).pipe(
    Match.when(Match.null, (): UnserializableDescription[] => []),
    Match.orElse((present: object) => describeStructuredObject(present)),
  )

const describeUnknownValue = (value: S.Unknown.Type): UnserializableDescription[] =>
  Match.value(NON_JSON_PRIMITIVE_TYPES[typeof value] === true).pipe(
    Match.when(true, (): UnserializableDescription[] => describedPrimitiveKind(value)),
    Match.orElse((): UnserializableDescription[] => describeNonNullish(value)),
  )

const describedPrimitiveKind = (value: S.Unknown.Type): UnserializableDescription[] => [
  {
    path: [],
    reason: `Primitive type "${typeof value}" has no JSON representation`,
  },
]

const describeInfiniteNumber = (value: number): UnserializableDescription[] =>
  Match.value(Number.isFinite(value)).pipe(
    Match.when(true, (): UnserializableDescription[] => []),
    Match.orElse((): UnserializableDescription[] => describedPrimitives(value)),
  )

const describeOptionsValue = (value: S.Unknown.Type): UnserializableDescription[] =>
  Match.value(value).pipe(
    Match.when(
      (numeric: S.Unknown.Type): numeric is number => typeof numeric === 'number',
      (whole) => describeInfiniteNumber(whole),
    ),
    Match.orElse((rest) => describeUnknownValue(rest)),
  )

const decide = (command: FindUnserializablesCommand): Result.Result<UnserializableDecision, never> =>
  Option.match(Option.liftPredicate(describeOptionsValue(command.options), (found) => found.length === 0), {
    onNone: (): Result.Result<UnserializableDecision, never> => Result.succeed(OptionsSerializable.make({})),
    onSome: (found: UnserializableDescription[]): Result.Result<UnserializableDecision, never> =>
      Result.succeed(
        OptionsUnserializable.make({ descriptions: found }),
      ),
  })

export const findUnserializables = Workflow.make({
  command: FindUnserializablesCommand,
  decision: S.Union([OptionsSerializable, OptionsUnserializable]),
  error: S.Never,
  decide,
})
