import * as S from 'effect/Schema'

export const SpecifierShape = S.Union([
  S.Literal('pkg'),
  S.Literal('pkg/feature'),
  S.Literal('@scope/pkg'),
  S.Literal('@scope/pkg/feature'),
])

export const KeyCase = S.Struct({
  specifier: SpecifierShape,
  root: S.optional(S.Literal('./root.mjs')),
  feature: S.optional(S.Literal('./sub.mjs')),
})

const NestedConditions = S.Union([
  S.Struct({ node: S.Literal('./deep-node.mjs'), default: S.Literal('./deep-default.mjs') }),
  S.Struct({ node: S.Literal('./deep-node.mjs') }),
  S.Struct({ default: S.Literal('./deep-default.mjs') }),
])

export const ConditionCase = S.Struct({
  node: S.optional(S.Union([S.Literal('./from-node.mjs'), NestedConditions])),
  import: S.optional(S.Literal('./from-import.mjs')),
  default: S.optional(S.Literal('./from-default.mjs')),
})

export const FallbackCase = S.Struct({
  specifier: S.Union([S.Literal('pkg'), S.Literal('pkg/feature')]),
  exports: S.optional(
    S.Union([
      S.Literal('./exported.mjs'),
      S.Struct({ './feature': S.Literal('./exported.mjs') }),
    ]),
  ),
  module: S.optional(S.Union([S.Literal('./from-module.mjs'), S.Literal('./lib/*.mjs')])),
  main: S.optional(S.Literal('from-main.js')),
})
