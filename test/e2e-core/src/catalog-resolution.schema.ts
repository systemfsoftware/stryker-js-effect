import * as S from 'effect/Schema'

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

export const DependencySpecs = S.Record(S.String, S.String)
export type DependencySpecs = typeof DependencySpecs.Type

export const FixtureManifestDocument = S.Record(S.String, S.Json)
export type FixtureManifestDocument = typeof FixtureManifestDocument.Type

export const FixtureManifestJson = S.fromJsonString(FixtureManifestDocument)

export const ManifestDependencies = S.Struct({
  dependencies: S.optionalKey(DependencySpecs),
  devDependencies: S.optionalKey(DependencySpecs),
  peerDependencies: S.optionalKey(DependencySpecs),
  optionalDependencies: S.optionalKey(DependencySpecs),
})
export type ManifestDependencies = typeof ManifestDependencies.Type

export const WorkspaceCatalogsYaml = S.Struct({
  catalog: S.optionalKey(DependencySpecs),
  catalogs: S.optionalKey(S.Record(S.String, DependencySpecs)),
})

export const LockedCatalogsYaml = S.Struct({
  catalogs: S.optionalKey(
    S.Record(S.String, S.Record(S.String, S.Struct({ specifier: S.String, version: S.String }))),
  ),
})
