import * as S from 'effect/Schema'

export const MockKindSchema = S.Literals(['manual', 'automock', 'autospy', 'redirect'])
export type MockKind = S.Schema.Type<typeof MockKindSchema>

export const MockRequestKindSchema = S.Literals(['manual', 'automock', 'autospy'])
export type MockRequestKind = S.Schema.Type<typeof MockRequestKindSchema>

export const SaltSchema = S.String.check(
  S.isMinLength(1),
  S.makeFilter((value: string) => !/[\ud800-\udfff?#&=]/.test(value), {
    expected: 'a salt with no query delimiters, lone surrogates, or fragment markers',
    arbitrary: { constraint: { minLength: 1 } },
  }),
)
export type Salt = S.Schema.Type<typeof SaltSchema>

const UriComponentSchema = S.String.check(
  S.isMinLength(1),
  S.makeFilter((value: string) => !/[\ud800-\udfff]/.test(value), {
    expected: 'a lone-surrogate-free string safe for encodeURIComponent',
    arbitrary: { constraint: { minLength: 1 } },
  }),
)

export const MockUrlSpecSchema = S.Struct({
  salt: SaltSchema,
  entryId: UriComponentSchema,
})
export type MockUrlSpec = S.Schema.Type<typeof MockUrlSpecSchema>

export const ExportNameSchema = S.String.check(
  S.isMinLength(1),
  S.makeFilter((value: string) => !/["\\\n\r]/.test(value), {
    expected: 'an export name with no quotes, backslashes, or newlines',
    arbitrary: { constraint: { minLength: 1 } },
  }),
)
export type ExportName = S.Schema.Type<typeof ExportNameSchema>
export const CleanUrlSchema = S.String.check(
  S.makeFilter((value: string) => !/[?#]/.test(value), {
    expected: 'a module url with no query or fragment marker',
    arbitrary: { constraint: { pattern: /[^?#]+/ } },
  }),
)
export type CleanUrl = S.Schema.Type<typeof CleanUrlSchema>
export const MockModuleSourceSpecSchema = S.Struct({
  entryId: S.String,
  raw: S.String,
  exportNames: S.Array(S.String),
})
export type MockModuleSourceSpec = S.Schema.Type<typeof MockModuleSourceSpecSchema>
