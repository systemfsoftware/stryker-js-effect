import * as S from 'effect/Schema'

export const ManifestDocument = S.fromJsonString(S.JsonObject)

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
