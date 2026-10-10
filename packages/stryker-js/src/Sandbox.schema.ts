import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

const JsonRecord = S.Record(S.String, S.Unknown)

const Entries = S.String.pipe(S.Array, S.optionalKey)

export const TsConfigSchema = S.StructWithRest(
  S.Struct({
    extends: S.optionalKey(S.Union([S.String, S.Array(S.String)])),
    references: S.StructWithRest(S.Struct({ path: S.String }), [JsonRecord]).pipe(S.Array, S.optionalKey),
    files: Entries,
    include: Entries,
    exclude: Entries,
  }),
  [JsonRecord],
)

export type TSConfig = S.Schema.Type<typeof TsConfigSchema>

export const ExtendsArraySchema = S.Array(S.String)

const entriesOf = (entries: ReadonlyArray<string> | undefined): ReadonlyArray<string> => entries ?? []

export const extendsEntriesOf = (config: TSConfig): ReadonlyArray<string> =>
  Match.value(config.extends).pipe(
    Match.when(Predicate.isUndefined, () => []),
    Match.when(Predicate.isString, (entry) => [entry]),
    Match.when(S.is(ExtendsArraySchema), (entries) => entries),
    Match.exhaustive,
  )

export const referencePathsOf = (config: TSConfig): ReadonlyArray<string> =>
  Option.match(Option.fromUndefinedOr(config.references), {
    onNone: () => [],
    onSome: (references) => Arr.map(references, (reference) => reference.path),
  })

export const referencedEntriesOf = (config: TSConfig): ReadonlyArray<string> => [
  ...entriesOf(config.include),
  ...entriesOf(config.exclude),
  ...entriesOf(config.files),
  ...extendsEntriesOf(config),
  ...referencePathsOf(config),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const Drawn = S.Array(S.String).pipe(S.check(S.isMaxLength(6)))
  const DrawnExtends = S.Union([S.String, Drawn])
  const DrawnConfig = S.Struct({
    include: S.optionalKey(Drawn),
    exclude: S.optionalKey(Drawn),
    files: S.optionalKey(Drawn),
    extends: S.optionalKey(DrawnExtends),
    references: S.optionalKey(Drawn),
  })
  type DrawnConfig = typeof DrawnConfig.Type

  const referencesOf = (paths: ReadonlyArray<string> | undefined): Pick<TSConfig, 'references'> =>
    Option.match(Option.fromUndefinedOr(paths), {
      onNone: () => ({}),
      onSome: (present) => ({ references: Arr.map(present, (path) => ({ path, prepend: true })) }),
    })

  const configOf = ({ references, ...rest }: DrawnConfig): TSConfig => ({
    ...rest,
    ...referencesOf(references),
    compilerOptions: { strict: true },
  })

  const extendsListOf = (drawn: DrawnConfig['extends']): ReadonlyArray<string> => [drawn ?? []].flat()

  const sameSequence = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
    left.length === right.length && Arr.every(Arr.zip(left, right), ([entry, other]) => entry === other)

  it.prop(
    '∀config_ExtendsEntries_≡EveryExtendsEntryInOrder',
    { of: [DrawnConfig], subject: extendsEntriesOf },
    (subject, [drawn]) => sameSequence(subject(configOf(drawn)), extendsListOf(drawn.extends)),
  )

  it.prop(
    '∀config_ReferencePaths_≡EveryReferencePathInOrder',
    { of: [DrawnConfig], subject: referencePathsOf },
    (subject, [drawn]) => sameSequence(subject(configOf(drawn)), entriesOf(drawn.references)),
  )
}
