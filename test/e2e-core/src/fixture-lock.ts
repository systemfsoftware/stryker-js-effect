import * as Boolean from 'effect/Boolean'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { resolveCatalogSpecs, type ResolveFailure, type WorkspaceCatalogs } from './catalog-resolution.js'
import { type FixtureManifestDocument, MalformedFixtureManifest } from './catalog-resolution.schema.js'
import { pinnedFieldsOf } from './registry-pins.js'
import { PinnableFields, type RegistryPins } from './registry-pins.schema.js'

export const tarballFileOf = (packageName: string): string => `${packageName.replace(/^@/, '').replace('/', '-')}.tgz`

export interface StagedManifestInput {
  readonly manifestPath: string
  readonly document: FixtureManifestDocument
  readonly catalogs: WorkspaceCatalogs
  readonly pins: RegistryPins
  readonly root: boolean
  readonly closure: Readonly<Record<string, string>>
}

const closureFieldsOf = (input: StagedManifestInput, fields: PinnableFields): PinnableFields =>
  Boolean.match(input.root && !Rec.isEmptyRecord(input.closure), {
    onFalse: () => ({}),
    onTrue: () => ({ devDependencies: { ...fields.devDependencies, ...input.closure } }),
  })

const pinnableFieldsOf = (
  manifestPath: string,
  document: FixtureManifestDocument,
): Result.Result<PinnableFields, MalformedFixtureManifest> =>
  Result.mapError(
    S.decodeResult(PinnableFields)(document),
    () => MalformedFixtureManifest.make({ manifest: manifestPath, detail: 'overrides is not a map of version ranges' }),
  )

export const stagedManifestOf = (input: StagedManifestInput): Result.Result<FixtureManifestDocument, ResolveFailure> =>
  Result.flatMap(
    resolveCatalogSpecs({ manifest: input.manifestPath, document: input.document, catalogs: input.catalogs }),
    (resolved) =>
      Result.map(pinnableFieldsOf(input.manifestPath, resolved), (fields) => {
        const pinned = { ...fields, ...pinnedFieldsOf({ manifest: fields, pins: input.pins, root: input.root }) }
        return { ...resolved, ...pinned, ...closureFieldsOf(input, pinned) }
      }),
  )
