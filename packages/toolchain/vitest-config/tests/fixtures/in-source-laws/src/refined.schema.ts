import { Schema as S } from 'effect'

export const Gamma = S.Int

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀n_Gamma_⊭Fraction',
    { of: [S.Int], subject: S.is(Gamma) },
    (accepts, [whole]) => accepts(whole) && !accepts(whole + 0.5),
  )
}
