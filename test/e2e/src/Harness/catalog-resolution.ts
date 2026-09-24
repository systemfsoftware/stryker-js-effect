import { Array, Boolean, Match, Option, Result, Schema } from 'effect'

import { MalformedFixtureManifest, UnresolvedCatalogSpec } from './harness-failure.schema.js'

export interface WorkspaceCatalogs {
  readonly default: Readonly<Record<string, string>>
  readonly named: Readonly<Record<string, Readonly<Record<string, string>>>>
}

type ResolveFailure = MalformedFixtureManifest | UnresolvedCatalogSpec

const CATALOG_PROTOCOL = 'catalog:'
const DEFAULT_CATALOG_NAMES: ReadonlyArray<string> = ['', 'default']
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const ManifestDocument = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const DependencyRecord = Schema.Record(Schema.String, Schema.String)

type CatalogMode =
  | { readonly _tag: 'None' }
  | { readonly _tag: 'Default' }
  | { readonly _tag: 'Named'; readonly name: string }

interface CatalogAccumulator {
  readonly mode: CatalogMode
  readonly default: Record<string, string>
  readonly named: Record<string, Record<string, string>>
}

const NONE_MODE: CatalogMode = { _tag: 'None' }
const DEFAULT_MODE: CatalogMode = { _tag: 'Default' }
const EMPTY_ACCUMULATOR: CatalogAccumulator = { mode: NONE_MODE, default: {}, named: {} }

const TOP_LEVEL_SECTION = /^([A-Za-z0-9_-]+):\s*$/
const CHILD_LINE = /^(\S.*?):(?:\s+(.*\S))?\s*$/

const bodyOf = (line: string): string => line.replace(/^\s+/, '')
const indentOf = (line: string): number => line.length - bodyOf(line).length
const stripOuterQuotes = (key: string): string => key.replace(/^(['"])(.*)\1$/, '$2')

const isSkippable = (body: string): boolean =>
  Boolean.match(body.length === 0, {
    onTrue: () => true,
    onFalse: () => body.startsWith('#'),
  })

const sectionMode = (section: string): CatalogMode =>
  Match.value(section).pipe(
    Match.when('catalog', () => DEFAULT_MODE),
    Match.when('catalogs', (): CatalogMode => ({ _tag: 'Named', name: '' })),
    Match.orElse(() => NONE_MODE),
  )

const topLevelStep = (state: CatalogAccumulator, body: string): CatalogAccumulator =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(TOP_LEVEL_SECTION.exec(body)), (match) => Option.fromNullishOr(match[1])),
    {
      onNone: () => ({ ...state, mode: NONE_MODE }),
      onSome: (section) => ({ ...state, mode: sectionMode(section) }),
    },
  )

const parseChildLine = (body: string): Option.Option<readonly [string, Option.Option<string>]> =>
  Option.flatMap(
    Option.fromNullishOr(CHILD_LINE.exec(body)),
    (match) =>
      Option.map(Option.fromNullishOr(match[1]), (key): readonly [string, Option.Option<string>] => [
        stripOuterQuotes(key),
        Option.fromNullishOr(match[2]),
      ]),
  )

const withDefaultEntry = (state: CatalogAccumulator, key: string, value: Option.Option<string>): CatalogAccumulator =>
  Option.match(value, {
    onNone: () => state,
    onSome: (range) => ({ ...state, default: { ...state.default, [key]: range } }),
  })

const withNamedEntry = (
  state: CatalogAccumulator,
  name: string,
  key: string,
  value: Option.Option<string>,
): CatalogAccumulator =>
  Option.match(value, {
    onNone: () =>
      Boolean.match(name.length === 0, {
        onTrue: (): CatalogAccumulator => ({ ...state, mode: { _tag: 'Named', name: key } }),
        onFalse: () => state,
      }),
    onSome: (range) =>
      Boolean.match(name.length === 0, {
        onTrue: () => state,
        onFalse: (): CatalogAccumulator => ({
          ...state,
          named: {
            ...state.named,
            [name]: {
              ...Option.getOrElse(Option.fromNullishOr(state.named[name]), (): Record<string, string> => ({})),
              [key]: range,
            },
          },
        }),
      }),
  })

const childStep = (state: CatalogAccumulator, body: string): CatalogAccumulator =>
  Option.match(parseChildLine(body), {
    onNone: () => state,
    onSome: ([key, value]) =>
      Match.value(state.mode).pipe(
        Match.tag('Default', () => withDefaultEntry(state, key, value)),
        Match.tag('Named', (mode) => withNamedEntry(state, mode.name, key, value)),
        Match.orElse(() => state),
      ),
  })

const stepLine = (state: CatalogAccumulator, rawLine: string): CatalogAccumulator => {
  const line = rawLine.replace(/\s+$/, '')
  const body = bodyOf(line)
  return Boolean.match(isSkippable(body), {
    onTrue: () => state,
    onFalse: () =>
      Boolean.match(indentOf(line) === 0, {
        onTrue: () => topLevelStep(state, body),
        onFalse: () => childStep(state, body),
      }),
  })
}

export const parseWorkspaceCatalogs = (text: string): WorkspaceCatalogs => {
  const accumulator = text.split('\n').reduce(stepLine, EMPTY_ACCUMULATOR)
  return { default: accumulator.default, named: accumulator.named }
}

const collect = <A, E>(results: ReadonlyArray<Result.Result<A, E>>): Result.Result<Array<A>, E> =>
  results.reduce<Result.Result<Array<A>, E>>(
    (accumulated, next) =>
      Result.match(accumulated, {
        onFailure: (failure) => Result.fail(failure),
        onSuccess: (values) => Result.map(next, (value) => [...values, value]),
      }),
    Result.succeed([]),
  )

const catalogFor = (catalogs: WorkspaceCatalogs, name: string): Option.Option<Readonly<Record<string, string>>> =>
  Boolean.match(DEFAULT_CATALOG_NAMES.includes(name), {
    onTrue: () => Option.some(catalogs.default),
    onFalse: () => Option.fromNullishOr(catalogs.named[name]),
  })

const resolveSpec = (
  manifest: string,
  catalogs: WorkspaceCatalogs,
  packageName: string,
  spec: string,
): Result.Result<string, UnresolvedCatalogSpec> =>
  Boolean.match(spec.startsWith(CATALOG_PROTOCOL), {
    onFalse: () => Result.succeed(spec),
    onTrue: () =>
      Option.match(
        Option.flatMap(
          catalogFor(catalogs, spec.slice(CATALOG_PROTOCOL.length)),
          (catalog) => Option.fromNullishOr(catalog[packageName]),
        ),
        {
          onNone: () => Result.fail(new UnresolvedCatalogSpec({ manifest, packageName, catalog: spec })),
          onSome: (range) => Result.succeed(range),
        },
      ),
  })

const resolveEntries = (
  manifest: string,
  catalogs: WorkspaceCatalogs,
  entries: Readonly<Record<string, string>>,
): Result.Result<Record<string, string>, ResolveFailure> =>
  Result.map(
    collect(Object.entries(entries).map(([packageName, spec]) => resolveSpec(manifest, catalogs, packageName, spec))),
    (ranges) => Object.fromEntries(Array.zip(Object.keys(entries), ranges)),
  )

const resolveField = (
  manifest: string,
  catalogs: WorkspaceCatalogs,
  field: string,
  value: unknown,
): Result.Result<Option.Option<Record<string, string>>, ResolveFailure> =>
  Option.match(Option.fromNullishOr(value), {
    onNone: () => Result.succeed(Option.none<Record<string, string>>()),
    onSome: (present) =>
      Result.match(Schema.decodeUnknownResult(DependencyRecord)(present), {
        onFailure: () =>
          Result.fail(new MalformedFixtureManifest({ manifest, detail: `"${field}" is not a map of version ranges` })),
        onSuccess: (entries) => Result.map(resolveEntries(manifest, catalogs, entries), Option.some),
      }),
  })

export const resolveCatalogSpecs = (
  manifest: string,
  packageJson: Record<string, unknown>,
  catalogs: WorkspaceCatalogs,
): Result.Result<Record<string, unknown>, ResolveFailure> =>
  Result.map(
    collect(DEPENDENCY_FIELDS.map((field) => resolveField(manifest, catalogs, field, packageJson[field]))),
    (fields) =>
      Array.zip(DEPENDENCY_FIELDS, fields).reduce<Record<string, unknown>>(
        (resolved, [field, value]) =>
          Option.match(value, {
            onNone: () => resolved,
            onSome: (entries) => ({ ...resolved, [field]: entries }),
          }),
        { ...packageJson },
      ),
  )

export const parseFixtureManifest = (
  manifest: string,
  bytes: Uint8Array,
): Result.Result<Record<string, unknown>, MalformedFixtureManifest> =>
  Result.mapError(
    Schema.decodeResult(ManifestDocument)(new TextDecoder().decode(bytes)),
    () => new MalformedFixtureManifest({ manifest, detail: 'the manifest is not a JSON object' }),
  )
