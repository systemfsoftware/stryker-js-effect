/// <reference types="vitest/importMeta" />
import { Schema as S } from 'effect'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'

export class TsConfigParseError
  extends S.TaggedError<TsConfigParseError, { readonly brand: unique symbol }>()('TsConfigParseError', {
    file: S.String,
    reason: S.String,
  })
{
  override get message(): string {
    return `Could not parse tsconfig file '${this.file}': ${this.reason}`
  }
}

export class TsConfigNotFoundError extends S.TaggedError<TsConfigNotFoundError, { readonly brand: unique symbol }>()(
  'TsConfigNotFoundError',
  {
    file: S.String,
  },
) {
  override get message(): string {
    return `The tsconfig file does not exist at: "${this.file}". Please configure the tsconfig file in your stryker.conf file using "tsconfigFile"`
  }
}

export const PathAliasesSchema = S.Record(S.String, S.Array(S.String))

const JsonRecord = S.Record(S.String, S.Json)

export const ProjectReferenceSchema = S.StructWithRest(S.Struct({ path: S.String }), [JsonRecord])

export const TsConfigCompilerOptionsSchema = JsonRecord

export type TsConfigCompilerOptions = S.Schema.Type<typeof TsConfigCompilerOptionsSchema>

export const TsConfigExtendsSchema = S.Union([S.String, S.Array(S.String)])

export const TsConfigDocumentSchema = S.StructWithRest(
  S.Struct({
    extends: S.optional(TsConfigExtendsSchema),
    references: S.optional(S.Array(ProjectReferenceSchema)),
    compilerOptions: S.optional(TsConfigCompilerOptionsSchema),
  }),
  [JsonRecord],
)

export type TsConfigDocument = S.Schema.Type<typeof TsConfigDocumentSchema>

export const ReferenceGraph = S.Record(S.String, S.Array(S.String))
export type ReferenceGraph = typeof ReferenceGraph.Type

export const FileHolders = S.Struct({
  references: ReferenceGraph,
  owner: S.String,
  holders: S.Array(S.String),
})
export type FileHolders = typeof FileHolders.Type

const referencesOf = (graph: ReferenceGraph, config: string): ReadonlyArray<string> =>
  Option.getOrElse(Rec.get(graph, config), (): ReadonlyArray<string> => [])

const reachedFrom = (
  graph: ReferenceGraph,
  pending: ReadonlyArray<string>,
  seen: HashSet.HashSet<string>,
): HashSet.HashSet<string> =>
  Option.match(Arr.head(pending), {
    onNone: () => seen,
    onSome: (config) =>
      Boolean.match(HashSet.has(seen, config), {
        onTrue: () => reachedFrom(graph, Arr.drop(pending, 1), seen),
        onFalse: () =>
          reachedFrom(graph, [...Arr.drop(pending, 1), ...referencesOf(graph, config)], HashSet.add(seen, config)),
      }),
  })

const reachesOwner = (holders: FileHolders, holder: string): boolean =>
  HashSet.has(reachedFrom(holders.references, referencesOf(holders.references, holder), HashSet.empty()), holders.owner)

export const otherCompilersOf = (holders: FileHolders): ReadonlyArray<string> =>
  Arr.filter(
    Arr.dedupe(holders.holders),
    (holder) => Boolean.and(holder !== holders.owner, Boolean.not(reachesOwner(holders, holder))),
  )

const accepts = {
  tsConfigDocument: S.is(TsConfigDocumentSchema),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const NODES = ['p0', 'p1', 'p2', 'p3', 'p4'] as const
  const Node = S.Literals(NODES)
  type Edge = readonly [string, string]

  const graphOf = (edges: ReadonlyArray<Edge>): ReferenceGraph =>
    Object.fromEntries(
      NODES.map((node) => [node, edges.filter(([from]) => from === node).map(([, to]) => to)] as const)
        .filter(([, targets]) => targets.length > 0),
    )

  const closureOf = (edges: ReadonlyArray<Edge>): ReadonlyArray<string> =>
    Arr.reduce(
      NODES,
      edges.map(([from, to]) => `${from}>${to}`),
      (reach) => [
        ...new Set([
          ...reach,
          ...reach.flatMap((pair) => {
            const [start, end] = pair.split('>')
            return edges.filter(([from]) => from === end).map(([, to]) => `${start}>${to}`)
          }),
        ]),
      ],
    )

  it.prop(
    '∀h_OtherCompilersOf_≡HoldersBesidesTheOwnerThatNoReferencePathLeadsFromToTheOwner',
    { of: [S.Array(S.Tuple([Node, Node])), Node, S.Array(Node)], subject: otherCompilersOf },
    (subject, [edges, owner, holders]) => {
      const reach = closureOf(edges)
      const expected = [...new Set(holders)].filter((holder) =>
        holder !== owner && !reach.includes(`${holder}>${owner}`)
      )
      return JSON.stringify(subject({ references: graphOf(edges), owner, holders })) === JSON.stringify(expected)
    },
  )

  type JsonValue = S.Schema.Type<typeof S.Json>

  const isJsonObject = S.is(S.Record(S.String, S.Json))
  const isJsonArray = S.is(S.Array(S.Json))
  const isStringArray = (value: JsonValue): boolean =>
    isJsonArray(value) && value.every((entry) => typeof entry === 'string')
  const isReference = (value: JsonValue): boolean => isJsonObject(value) && typeof value['path'] === 'string'
  const referencesHold = (references: JsonValue): boolean => isJsonArray(references) && references.every(isReference)
  const compilerOptionsHold = (compilerOptions: JsonValue): boolean => isJsonObject(compilerOptions)
  const extendsHold = (extended: JsonValue): boolean => typeof extended === 'string' || isStringArray(extended)
  const fieldHolds = (field: JsonValue | undefined, holds: (value: JsonValue) => boolean): boolean =>
    field === undefined || holds(field)
  const isDocument = (value: JsonValue): boolean =>
    isJsonObject(value) &&
    Arr.every([
      fieldHolds(value['extends'], extendsHold),
      fieldHolds(value['references'], referencesHold),
      fieldHolds(value['compilerOptions'], compilerOptionsHold),
    ], (
      holds,
    ) => holds)

  const seeds: ReadonlyArray<JsonValue> = [
    null,
    42,
    'tsconfig',
    [],
    {},
    { extends: './base.json' },
    { extends: ['./base.json', '@tsconfig/node20/tsconfig.json'] },
    { extends: [1] },
    { extends: {} },
    { references: [] },
    { references: [{}] },
    { references: [{ path: 'p' }] },
    { references: 'x' },
    { compilerOptions: {} },
    { compilerOptions: 'x' },
  ]

  it.prop(
    '∀j_TsConfigDocumentRefusal_≡DeclaredShape',
    { of: [S.Json], subject: accepts },
    (subject, [value]) =>
      Arr.every(Arr.append(seeds, value), (candidate) => subject.tsConfigDocument(candidate) === isDocument(candidate)),
  )
}
