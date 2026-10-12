import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const STRING_TOKEN = /("(?:[^"\\]|\\[\s\S])*")(\s*:)?/g

const decodeJsonObject = S.decodeUnknownEffect(S.fromJsonString(S.JsonObject))

const decodeJsonString = S.decodeUnknownEffect(S.fromJsonString(S.String))

const isJsonArray = (value: S.Json): value is ReadonlyArray<S.Json> => Arr.isArray(value)

const isJsonObject = (value: S.Json): value is S.JsonObject => Match.record(value)

const rekeyedBy = (keyAt: Record.ReadonlyRecord<string, string>) => {
  const rekeyedObject = (object: S.JsonObject): Effect.Effect<S.JsonObject> =>
    Effect.map(
      Effect.forEach(Object.entries(object), ([offset, member]) =>
        Effect.map(
          rekeyed(member),
          (value) => [Option.getOrElse(Record.get(keyAt, offset), () => offset), value] as const,
        )),
      Record.fromEntries,
    )
  const rekeyed = (value: S.Json): Effect.Effect<S.Json> =>
    Match.value(value).pipe(
      Match.when(isJsonArray, (items) => Effect.forEach(items, rekeyed)),
      Match.when(isJsonObject, rekeyedObject),
      Match.orElse((leaf) => Effect.succeed(leaf)),
    )
  return rekeyedObject
}

const keyTokensOf = (text: string): ReadonlyArray<RegExpExecArray> =>
  Arr.filter(Arr.fromIterable(text.matchAll(STRING_TOKEN)), (token) => token[0].length > token[1].length)

const placeheld = (text: string): string =>
  text.replace(
    STRING_TOKEN,
    (token: string, _literal: string, colon: string | undefined, offset: number) =>
      Option.match(Option.fromUndefinedOr(colon), {
        onNone: () => token,
        onSome: (separator) => `"${offset}"${separator}`,
      }),
  )

/**
 * Works around nodejs/node#63785 (V8 12.8 to 14.6, so Node 24 and 26): after one parse builds an object whose key ends
 * in an escaped backslash, a later parse can read a different escaped key as that one. Only object keys take that path,
 * so keys are swapped for their text offsets before the parse and decoded one by one. Drop this once CI's Node carries
 * the V8 fix 93cd21e (nodejs/node#66542).
 */
const decodeJsonWithExactKeys = (text: string) =>
  Effect.gen(function*() {
    yield* decodeJsonObject(text)
    const tokens = keyTokensOf(text)
    const keys = yield* Effect.forEach(tokens, (token) => decodeJsonString(token[1]))
    const keyAt = Record.fromEntries(Arr.zip(tokens.map((token) => `${token.index}`), keys))
    return yield* rekeyedBy(keyAt)(yield* decodeJsonObject(placeheld(text)))
  })

export const ManifestDocument = S.String.annotate({
  expected: 'a string that will be decoded as JSON',
  contentMediaType: 'application/json',
}).pipe(
  S.decodeTo(
    S.JsonObject,
    SchemaTransformation.makeTransformation({
      decode: SchemaGetter.transformEffect((text: string) =>
        Effect.mapError(decodeJsonWithExactKeys(text), (error) => error.issue)
      ),
      encode: SchemaGetter.stringifyJson(),
    }),
  ),
)

export const DependencyRecord = S.Record(S.String, S.String)

export const CatalogMode = S.TaggedUnion({
  None: {},
  Default: {},
  Named: { name: S.String },
})
export type CatalogMode = typeof CatalogMode.Type

export class MalformedFixtureManifest extends S.TaggedError<MalformedFixtureManifest>()('MalformedFixtureManifest', {
  manifest: S.String,
  detail: S.String,
}) {
  override get message(): string {
    return `${this.manifest}: ${this.detail}`
  }
}

export class UnresolvedCatalogSpec extends S.TaggedError<UnresolvedCatalogSpec>()('UnresolvedCatalogSpec', {
  manifest: S.String,
  packageName: S.String,
  catalog: S.String,
}) {
  override get message(): string {
    return `${this.manifest}: "${this.packageName}" is missing from the ${this.catalog} catalog in pnpm-workspace.yaml`
  }
}
