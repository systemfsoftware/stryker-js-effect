import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { parse } from 'yaml'

import {
  type DependencySpecs,
  type FixtureManifestDocument,
  FixtureManifestJson,
  LockedCatalogsYaml,
  MalformedFixtureManifest,
  ManifestDependencies,
  UnresolvedCatalogSpec,
  WorkspaceCatalogsYaml,
} from './catalog-resolution.schema.js'

export interface WorkspaceCatalogs {
  readonly default: Readonly<Record<string, string>>
  readonly named: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export type ResolveFailure = MalformedFixtureManifest | UnresolvedCatalogSpec

const CATALOG_PROTOCOL = 'catalog:'
const DEFAULT_CATALOG_NAMES: ReadonlyArray<string> = ['', 'default']
const DEFAULT_CATALOG = 'default'
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const NO_SPECS: DependencySpecs = {}
const NO_CATALOGS: WorkspaceCatalogs = { default: NO_SPECS, named: {} }

const workspaceYamlOf = Option.liftThrowable((text: string) =>
  S.decodeUnknownOption(WorkspaceCatalogsYaml)(parse(text))
)

const lockYamlOf = Option.liftThrowable((text: string) => S.decodeUnknownOption(LockedCatalogsYaml)(parse(text)))

const orEmpty = <A>(record: Readonly<Record<string, A>> | undefined): Readonly<Record<string, A>> =>
  Option.getOrElse(Option.fromUndefinedOr(record), () => ({}))

const catalogsOf = (catalogs: Readonly<Record<string, DependencySpecs>>, fallback: DependencySpecs) => ({
  default: Option.getOrElse(Rec.get(catalogs, DEFAULT_CATALOG), () => fallback),
  named: Rec.remove(catalogs, DEFAULT_CATALOG),
})

export const parseWorkspaceCatalogs = (text: string): WorkspaceCatalogs =>
  pipe(
    Option.flatten(workspaceYamlOf(text)),
    Option.map((workspace): WorkspaceCatalogs => catalogsOf(orEmpty(workspace.catalogs), orEmpty(workspace.catalog))),
    Option.getOrElse(() => NO_CATALOGS),
  )

export const parseLockedCatalogs = (pnpmLockfile: string): WorkspaceCatalogs =>
  pipe(
    Option.flatten(lockYamlOf(pnpmLockfile)),
    Option.map((lock) => Rec.map(orEmpty(lock.catalogs), (entries) => Rec.map(entries, (entry) => entry.version))),
    Option.map((catalogs): WorkspaceCatalogs => catalogsOf(catalogs, NO_SPECS)),
    Option.getOrElse(() => NO_CATALOGS),
  )

const pinnedCatalog = (
  ranges: Readonly<Record<string, string>>,
  locked: Readonly<Record<string, string>>,
): Record<string, string> => Rec.map(ranges, (range, name) => Option.getOrElse(Rec.get(locked, name), () => range))

export const pinnedCatalogsOf = (
  catalogs: { readonly workspace: WorkspaceCatalogs; readonly locked: WorkspaceCatalogs },
): WorkspaceCatalogs => ({
  default: pinnedCatalog(catalogs.workspace.default, catalogs.locked.default),
  named: Rec.map(
    catalogs.workspace.named,
    (ranges, name) => pinnedCatalog(ranges, Option.getOrElse(Rec.get(catalogs.locked.named, name), () => NO_SPECS)),
  ),
})

const catalogFor = (catalogs: WorkspaceCatalogs, name: string): Option.Option<Readonly<Record<string, string>>> =>
  Boolean.match(DEFAULT_CATALOG_NAMES.includes(name), {
    onTrue: () => Option.some(catalogs.default),
    onFalse: () => Rec.get(catalogs.named, name),
  })

const catalogNameOf = (spec: string): Option.Option<string> =>
  Option.map(
    Option.filter(Option.some(spec), (candidate) => candidate.startsWith(CATALOG_PROTOCOL)),
    (candidate) => candidate.slice(CATALOG_PROTOCOL.length),
  )

const catalogEntryOf = (catalogs: WorkspaceCatalogs, packageName: string, catalog: string): Option.Option<string> =>
  Option.flatMap(catalogFor(catalogs, catalog), (entries) => Rec.get(entries, packageName))

const resolveSpec = (
  manifest: string,
  catalogs: WorkspaceCatalogs,
  [packageName, spec]: readonly [string, string],
): Result.Result<readonly [string, string], UnresolvedCatalogSpec> =>
  Option.match(catalogNameOf(spec), {
    onNone: () => Result.succeed([packageName, spec] as const),
    onSome: (catalog) =>
      Option.match(catalogEntryOf(catalogs, packageName, catalog), {
        onNone: () => Result.fail(UnresolvedCatalogSpec.make({ manifest, packageName, catalog: spec })),
        onSome: (range) => Result.succeed([packageName, range] as const),
      }),
  })

const resolveSpecs = (
  manifest: string,
  catalogs: WorkspaceCatalogs,
  specs: DependencySpecs,
): Result.Result<DependencySpecs, UnresolvedCatalogSpec> =>
  Result.map(
    Result.all(Object.entries(specs).map((entry) => resolveSpec(manifest, catalogs, entry))),
    (entries) => Object.fromEntries(entries),
  )

const dependenciesOf = (
  manifest: string,
  document: FixtureManifestDocument,
): Result.Result<ManifestDependencies, MalformedFixtureManifest> =>
  Result.mapError(
    S.decodeResult(ManifestDependencies)(document),
    () => MalformedFixtureManifest.make({ manifest, detail: 'a dependency field is not a map of version ranges' }),
  )

const presentFieldsOf = (dependencies: ManifestDependencies) =>
  DEPENDENCY_FIELDS.flatMap((field) =>
    Option.toArray(Option.map(Option.fromUndefinedOr(dependencies[field]), (specs) => [field, specs] as const))
  )

export const resolveCatalogSpecs = (
  input: {
    readonly manifest: string
    readonly document: FixtureManifestDocument
    readonly catalogs: WorkspaceCatalogs
  },
): Result.Result<FixtureManifestDocument, ResolveFailure> =>
  Result.flatMap(dependenciesOf(input.manifest, input.document), (dependencies) =>
    Result.map(
      Result.all(
        presentFieldsOf(dependencies).map(([field, specs]) =>
          Result.map(resolveSpecs(input.manifest, input.catalogs, specs), (resolved) => [field, resolved] as const)
        ),
      ),
      (fields) => ({ ...input.document, ...Object.fromEntries(fields) }),
    ))

export const parseFixtureManifest = (
  input: { readonly manifest: string; readonly bytes: Uint8Array },
): Result.Result<FixtureManifestDocument, MalformedFixtureManifest> =>
  Result.mapError(
    S.decodeResult(FixtureManifestJson)(new TextDecoder().decode(input.bytes)),
    () => MalformedFixtureManifest.make({ manifest: input.manifest, detail: 'the manifest is not a JSON object' }),
  )

const lockedPinOf = (locked: WorkspaceCatalogs, [packageName, spec]: readonly [string, string]) =>
  Option.toArray(Option.map(
    Option.flatMap(catalogNameOf(spec), (catalog) => catalogEntryOf(locked, packageName, catalog)),
    (version) => [packageName, version] as const,
  ))

export const catalogPinsOf = (
  input: { readonly document: FixtureManifestDocument; readonly locked: WorkspaceCatalogs },
): Record<string, string> =>
  pipe(
    S.decodeOption(ManifestDependencies)(input.document),
    Option.map((dependencies) =>
      Object.fromEntries(
        presentFieldsOf(dependencies).flatMap(([, specs]) =>
          Object.entries(specs).flatMap((entry) => lockedPinOf(input.locked, entry))
        ),
      )
    ),
    Option.getOrElse((): Record<string, string> => ({})),
  )
