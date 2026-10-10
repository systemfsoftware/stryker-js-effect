import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import type * as S from 'effect/Schema'

import type { ScriptLanguage } from '../import-closure.schema.js'

export interface ParsedSource {
  readonly program: S.Json
  readonly parseFailed: boolean
}

type OxcValue = object | string | number | boolean | bigint | symbol | null | undefined

type OxcRecord = Readonly<Record<string, OxcValue>>

const oxcModule = Effect.cached(Effect.promise(() => import('oxc-parser')))

const isOxcArray = (value: OxcValue): value is ReadonlyArray<OxcValue> => Array.isArray(value)

const isOxcRecord = (value: OxcValue): value is OxcRecord => Predicate.isObject(value)

const itemOf = (value: OxcValue): S.Json => Result.getOrElse(jsonOf(value), () => null)

const isJsonLeaf = Predicate.or(
  Predicate.or(Predicate.isString, Predicate.isNumber),
  Predicate.or(Predicate.isBoolean, Predicate.isNull),
)

// oxc sets a bigint or RegExp `Literal.value` after parsing; the literal's `raw` keeps its text.
const isNonJsonLeaf = Predicate.or(Predicate.isBigInt, Predicate.isRegExp)

const NULL_LEAF: Result.Result<S.Json, void> = Result.succeed(null)

const jsonOf: (value: OxcValue) => Result.Result<S.Json, void> = Match.type<OxcValue>().pipe(
  Match.when(isJsonLeaf, (leaf) => Result.succeed(leaf)),
  Match.when(isOxcArray, (values) => Result.succeed(values.map(itemOf))),
  Match.when(isNonJsonLeaf, () => NULL_LEAF),
  Match.when(isOxcRecord, (record) => Result.succeed(Record.filterMap(record, jsonOf))),
  Match.orElse(() => Result.failVoid),
)

export const parseSource = Effect.fnUntraced(function*(absolute: string, content: string, language: ScriptLanguage) {
  const oxc = yield* Effect.flatMap(oxcModule, (load) => load)
  const parsed = oxc.parseSync(absolute, content, { lang: language })
  return { program: itemOf(parsed.program), parseFailed: parsed.errors.length > 0 } satisfies ParsedSource
})

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Boolean = await import('effect/Boolean')
  const Schema = await import('effect/Schema')

  const isJsonArray = (value: S.Json): value is S.JsonArray => Array.isArray(value)

  const isJsonObject = (value: S.Json): value is S.JsonObject => Predicate.isObject(value)

  const objectsOf = (value: S.Json): ReadonlyArray<S.JsonObject> =>
    Match.value(value).pipe(
      Match.when(isJsonArray, (values) => values.flatMap(objectsOf)),
      Match.when(isJsonObject, (object) => [object, ...Object.values(object).flatMap(objectsOf)]),
      Match.orElse(() => []),
    )

  const isLiteral = (object: S.JsonObject): boolean => object['type'] === 'Literal'

  const isValueNull = (object: S.JsonObject): boolean => object['value'] === null

  const rawIs = (raw: string) => (object: S.JsonObject): boolean => object['raw'] === raw

  const nulledLiteralKeeps = (objects: ReadonlyArray<S.JsonObject>, raw: string): boolean =>
    objects.some(Predicate.and(Predicate.and(isLiteral, isValueNull), rawIs(raw)))

  const holdsEmptyObject = (objects: ReadonlyArray<S.JsonObject>): boolean =>
    objects.some((object) => Object.keys(object).length === 0)

  const lawHolds = (objects: ReadonlyArray<S.JsonObject>, bigint: string, regExp: string): boolean =>
    Boolean.and(
      Boolean.and(nulledLiteralKeeps(objects, bigint), nulledLiteralKeeps(objects, regExp)),
      !holdsEmptyObject(objects),
    )

  it.effect.prop(
    '∀s_BigIntAndRegExpArguments_≡NullValueRawKeptNoEmptyObject',
    {
      of: [
        Schema.Literals(['vi.mock', 'require', 'import']),
        Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,24}$/)),
        Schema.String.check(Schema.isPattern(/^[a-z]{1,8}$/)),
        Schema.Literals(['', 'g', 'iu', 'dgimsuy']),
      ],
      subject: itemOf,
    },
    (subject, [callee, digits, body, flags]) =>
      Effect.map(Effect.flatMap(oxcModule, (load) => load), (oxc) => {
        const source = `${callee}(${digits}n)\n${callee}(/${body}/${flags})\n`
        const objects = objectsOf(subject(oxc.parseSync('drawn.ts', source, { lang: 'ts' }).program))
        return lawHolds(objects, `${digits}n`, `/${body}/${flags}`)
      }),
  )
}
