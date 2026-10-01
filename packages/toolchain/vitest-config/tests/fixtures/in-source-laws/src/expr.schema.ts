import { Schema as S } from 'effect'

type Expr =
  | { readonly _tag: 'Lit'; readonly value: number }
  | { readonly _tag: 'Wrap'; readonly inner: Expr }

const Lit = S.Struct({ _tag: S.Literal('Lit'), value: S.Int })

const Wrap = S.Struct({
  _tag: S.Literal('Wrap'),
  inner: S.suspend((): S.Codec<Expr> => Expr),
})

export const Expr: S.Codec<Expr> = S.suspend((): S.Codec<Expr> => S.Union([Lit, Wrap])).annotate({
  recursionBudget: { maxDepth: 6, depthSize: 'medium' },
})
