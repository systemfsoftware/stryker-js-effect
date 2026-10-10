import * as Effect from 'effect/Effect'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import type { ScriptLanguage } from '../import-closure.schema.js'

export interface ParsedSource {
  readonly program: S.Json
  readonly parseFailed: boolean
}

const oxcModule = Effect.cached(Effect.promise(() => import('oxc-parser')))

// oxc sets a BigInt or RegExp `Literal.value` after parsing; neither is JSON. The literal's `raw` keeps its text.
const isNonJsonLeaf = Predicate.or(Predicate.isBigInt, Predicate.isRegExp)

const jsonLeafOf = <A>(_key: string, value: A): A | null => isNonJsonLeaf(value) ? null : value

const encodeProgram = S.encodeEffect(S.fromJsonString(S.Unknown, { replacer: jsonLeafOf }))

const decodeProgram = S.decodeEffect(S.fromJsonString(S.Json))

export const parseSource = Effect.fnUntraced(function*(absolute: string, content: string, language: ScriptLanguage) {
  const oxc = yield* Effect.flatMap(oxcModule, (load) => load)
  const parsed = oxc.parseSync(absolute, content, { lang: language })
  const program = yield* Effect.orDie(Effect.flatMap(encodeProgram(parsed.program), decodeProgram))
  return { program, parseFailed: parsed.errors.length > 0 } satisfies ParsedSource
})
