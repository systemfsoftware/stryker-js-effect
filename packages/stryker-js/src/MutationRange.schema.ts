import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SchemaIssue from 'effect/SchemaIssue'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const MUTATION_RANGE_SPECIFIER = /(.*?):((\d+)(?::(\d+))?-(\d+)(?::(\d+))?)$/

const NON_NEGATIVE_LINE = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(0)))

const ancestorFileOf = (file: string): string | undefined => {
  const parts = MUTATION_RANGE_SPECIFIER.exec(`${file}:0-0`)
  return Option.getOrUndefined(Option.map(Option.fromNullOr(parts), (match) => match[1]))
}

const isCanonicalFile = (file: string): boolean => ancestorFileOf(file) === file

const CanonicalFile = S.String.pipe(
  S.check(
    S.makeFilter(isCanonicalFile, {
      expected: 'a mutation range file with no earlier colon split',
      arbitrary: { constraint: { patterns: ['^[^:\\n]*(?::[^:\\n\\d][^:\\n]*)*$'] } },
    }),
  ),
)

export const MutationRangeSpecifier = S.Struct({
  file: CanonicalFile,
  startLine: NON_NEGATIVE_LINE,
  startColumn: S.optionalKey(NON_NEGATIVE_LINE),
  endLine: NON_NEGATIVE_LINE,
  endColumn: S.optionalKey(NON_NEGATIVE_LINE),
})

export type MutationRangeSpecifier = typeof MutationRangeSpecifier.Type

type DecodedSpecifier = MutationRangeSpecifier


const startTextOf = (specifier: DecodedSpecifier): string =>
  Option.match(Option.fromUndefinedOr(specifier.startColumn), {
    onNone: () => `${specifier.startLine}`,
    onSome: (column) => `${specifier.startLine}:${column}`,
  })

const endTextOf = (specifier: DecodedSpecifier): string =>
  Option.match(Option.fromUndefinedOr(specifier.endColumn), {
    onNone: () => `${specifier.endLine}`,
    onSome: (column) => `${specifier.endLine}:${column}`,
  })

const renderedRangeOf = (specifier: DecodedSpecifier): string =>
  `${startTextOf(specifier)}-${endTextOf(specifier)}`

const groupOf = (match: RegExpExecArray, index: number, fallback: string) => match[index] ?? fallback

const numberGroupOf = (match: RegExpExecArray, index: number, fallback: string) =>
  Number(groupOf(match, index, fallback))

const columnGroupOf = (match: RegExpExecArray, index: number) => Option.fromUndefinedOr(match[index])

const startColumnOf = (match: RegExpExecArray) =>
  Option.match(columnGroupOf(match, 4), {
    onNone: () => ({}),
    onSome: (column) => ({ startColumn: Number(column) }),
  })

const endColumnOf = (match: RegExpExecArray) =>
  Option.match(columnGroupOf(match, 6), {
    onNone: () => ({}),
    onSome: (column) => ({ endColumn: Number(column) }),
  })

const decodedPartsOf = (match: RegExpExecArray, specifier: string): DecodedSpecifier => ({
  file: groupOf(match, 1, specifier),
  startLine: numberGroupOf(match, 3, '1'),
  ...startColumnOf(match),
  endLine: numberGroupOf(match, 5, '1'),
  ...endColumnOf(match),
})

export const MutationRangeSpecifierSchema = S.String.pipe(
  S.decodeTo(
    MutationRangeSpecifier,
    SchemaTransformation.transformEffect({
      decode: (specifier, options): Effect.Effect<MutationRangeSpecifier, SchemaIssue.Issue> => {
        const parts = MUTATION_RANGE_SPECIFIER.exec(specifier)
        return Option.match(Option.fromNullOr(parts), {
          onNone: () =>
            Effect.fail(
              new SchemaIssue.InvalidValue({ expected: 'a mutation range specifier' }, specifier, options),
            ),
          onSome: (match) => Effect.succeed(decodedPartsOf(match, specifier)),
        })
      },
      encode: (specifier) => Effect.succeed(`${specifier.file}:${renderedRangeOf(specifier)}`),
    }),
  ),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')

  const FilePartSchema = S.String.pipe(S.check(S.isMaxLength(64)))
  const PositionSchema = S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 10_000 })))
  const NegativeSchema = S.Int.pipe(S.check(S.isBetween({ minimum: -10_000, maximum: -1 })))

  it.prop('∀file_pos_NonCanonicalFile_DecodeNone', [FilePartSchema, PositionSchema], ([file, position]) =>
    Option.isNone(
      S.decodeOption(MutationRangeSpecifier)({ file: `${file}:${position}`, startLine: 1, endLine: 1 }),
    ))

  it.prop(
    '∀startLine_endLine_col_NegativePosition_DecodeNone',
    [NegativeSchema, NegativeSchema, NegativeSchema, NegativeSchema],
    ([startLine, endLine, startColumn, endColumn]) =>
      [
        { file: 'src/a.ts', startLine, endLine: 1 },
        { file: 'src/a.ts', startLine: 1, endLine },
        { file: 'src/a.ts', startLine: 1, endLine: 1, startColumn },
        { file: 'src/a.ts', startLine: 1, endLine: 1, endColumn },
      ].every((specifier) => Option.isNone(S.decodeOption(MutationRangeSpecifier)(specifier))),
  )
}
