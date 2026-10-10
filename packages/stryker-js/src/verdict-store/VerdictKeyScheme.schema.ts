import * as S from 'effect/Schema'

const SchemeToken = S.String.check(
  S.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { expected: 'a lowercase, hyphen-separated token' }),
)

export const VerdictKeySchemeSchema = S.Struct({
  layout: SchemeToken,
  keyDigest: SchemeToken,
  mutantIds: SchemeToken,
})
export type VerdictKeyScheme = typeof VerdictKeySchemeSchema.Type

export const VerdictKeyScheme: VerdictKeyScheme = {
  layout: 'verdict-key-1',
  keyDigest: 'sha256',
  mutantIds: 'mutant-id-sha256',
}

export const schemeNameOf = (scheme: VerdictKeyScheme): string =>
  `${scheme.layout}+${scheme.keyDigest}+${scheme.mutantIds}`

export const schemeDirectoryOf = (scheme: VerdictKeyScheme) => (mutantId: string): string =>
  `${schemeNameOf(scheme)}/${mutantId}`
