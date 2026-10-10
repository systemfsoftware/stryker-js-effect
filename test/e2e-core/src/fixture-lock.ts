import * as Boolean from 'effect/Boolean'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  lockedCatalogNamesOf,
  parseFixtureManifest,
  parseLockedCatalogs,
  parseWorkspaceCatalogs,
  pinnedCatalogsOf,
  resolveCatalogSpecs,
  type ResolveFailure,
  type WorkspaceCatalogs,
} from './catalog-resolution.js'
import { type FixtureManifestDocument, MalformedFixtureManifest } from './catalog-resolution.schema.js'
import { FixtureManifest, type PackedManifest, type PackedMember } from './install-closure.schema.js'
import { installClosure, InstallClosureCommand, type InstallClosureFailure } from './install-closure.workflow.js'
import { pinnedFieldsOf, registryPinsOf } from './registry-pins.js'
import { PinnableFields, type RegistryPins } from './registry-pins.schema.js'

export const tarballFileOf = (packageName: string): string => `${packageName.replace(/^@/, '').replace('/', '-')}.tgz`

const PACKS_FROM_FIXTURE = '../../packs'

export const packedMemberOf = (manifest: PackedManifest): PackedMember => ({
  tarballPath: `${PACKS_FROM_FIXTURE}/${tarballFileOf(manifest.name)}`,
  manifest,
})

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
    resolveCatalogSpecs(input.manifestPath, input.document, input.catalogs),
    (resolved) =>
      Result.map(pinnableFieldsOf(input.manifestPath, resolved), (fields) => {
        const pinned = { ...fields, ...pinnedFieldsOf({ manifest: fields, pins: input.pins, root: input.root }) }
        return { ...resolved, ...pinned, ...closureFieldsOf(input, pinned) }
      }),
  )

const MANIFEST_FILE = 'package.json'

export interface FixtureManifestBytes {
  readonly relativePath: string
  readonly bytes: Uint8Array
}

export interface FixtureStagingInput {
  readonly fixtureId: string
  readonly manifests: ReadonlyArray<FixtureManifestBytes>
  readonly members: ReadonlyArray<PackedMember>
  readonly workspace: ReadonlyArray<string>
  readonly pnpmLockfile: string
  readonly workspaceYaml: string
}

export interface StagedFixtureFile {
  readonly relativePath: string
  readonly document: FixtureManifestDocument
}

export interface StagedFixture {
  readonly manifests: ReadonlyArray<StagedFixtureFile>
  readonly closure: ReadonlyArray<string>
  readonly pins: Readonly<Record<string, string>>
}

export type StageFixtureFailure = ResolveFailure | InstallClosureFailure

const parsedManifestsOf = (input: FixtureStagingInput) =>
  Result.all(input.manifests.map((file) =>
    Result.map(
      parseFixtureManifest(`${input.fixtureId}/${file.relativePath}`, file.bytes),
      (document): StagedFixtureFile => ({ relativePath: file.relativePath, document }),
    )
  ))

const closureManifestOf = (fixtureId: string, file: StagedFixtureFile) =>
  Result.mapError(
    Result.map(S.decodeResult(FixtureManifest)(file.document), (manifest) => ({ path: file.relativePath, manifest })),
    () =>
      MalformedFixtureManifest.make({ manifest: `${fixtureId}/${file.relativePath}`, detail: 'not a package.json' }),
  )

export const stagedFixtureOf = (input: FixtureStagingInput): Result.Result<StagedFixture, StageFixtureFailure> =>
  Result.gen(function*() {
    const parsed = yield* parsedManifestsOf(input)
    const fixtures = yield* Result.all(parsed.map((file) => closureManifestOf(input.fixtureId, file)))
    const install = yield* installClosure(
      InstallClosureCommand.make({ members: input.members, fixtures, workspace: input.workspace }),
    )
    const locked = parseLockedCatalogs(input.pnpmLockfile)
    const catalogs = pinnedCatalogsOf({ workspace: parseWorkspaceCatalogs(input.workspaceYaml), locked })
    const registryPins = registryPinsOf(input.pnpmLockfile, lockedCatalogNamesOf(locked))
    const manifests = yield* Result.all(parsed.map((file) =>
      Result.map(
        stagedManifestOf({
          manifestPath: `${input.fixtureId}/${file.relativePath}`,
          document: file.document,
          catalogs,
          pins: registryPins,
          root: file.relativePath === MANIFEST_FILE,
          closure: file.relativePath === MANIFEST_FILE ? install.dependencies : {},
        }),
        (document): StagedFixtureFile => ({ relativePath: file.relativePath, document }),
      )
    ))
    return { manifests, closure: Object.keys(install.dependencies).sort(), pins: registryPins }
  })
