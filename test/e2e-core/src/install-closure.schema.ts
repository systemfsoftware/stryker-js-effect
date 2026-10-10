import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as S from 'effect/Schema'

const EdgeSpecs = S.optional(S.Record(S.String, S.String))

const PeerDependenciesMeta = S.optional(S.Record(S.String, S.Struct({ optional: S.optional(S.Boolean) })))

export const WorkspaceManifest = S.Struct({
  name: S.String,
  dependencies: EdgeSpecs,
  peerDependencies: EdgeSpecs,
  peerDependenciesMeta: PeerDependenciesMeta,
  optionalDependencies: EdgeSpecs,
})
export type WorkspaceManifest = typeof WorkspaceManifest.Type

export const PackedManifest = S.Struct({ ...WorkspaceManifest.fields, version: S.String })
export type PackedManifest = typeof PackedManifest.Type

export const PackedMember = S.Struct({ tarballPath: S.String, manifest: PackedManifest })
export type PackedMember = typeof PackedMember.Type

export const FixtureManifest = S.Struct({
  dependencies: EdgeSpecs,
  devDependencies: EdgeSpecs,
  peerDependencies: EdgeSpecs,
  peerDependenciesMeta: PeerDependenciesMeta,
  optionalDependencies: EdgeSpecs,
})
export type FixtureManifest = typeof FixtureManifest.Type

export const StagedFixtureManifest = S.Struct({ path: S.String, manifest: FixtureManifest })
export type StagedFixtureManifest = typeof StagedFixtureManifest.Type

export interface ClosureEdge {
  readonly dependent: string
  readonly dependency: string
  readonly target: string
}

type EdgeSpecs = Readonly<Record<string, string>>

type PeerEdges = Pick<WorkspaceManifest, 'peerDependencies' | 'peerDependenciesMeta'>

const ALIAS_TARGETS = [
  /^npm:((?:@[^/@]+\/)?[^/@]+)(?:@.*)?$/,
  /^workspace:((?:@[^/@]+\/)?[^/@]+)@/,
]

const NO_EDGES: EdgeSpecs = {}

const specsOf = (specs: EdgeSpecs | undefined): EdgeSpecs =>
  Option.getOrElse(Option.fromUndefinedOr(specs), () => NO_EDGES)

const targetOf = (dependency: string, spec: string): string =>
  Option.getOrElse(
    Arr.findFirst(ALIAS_TARGETS, (alias) => Option.flatMap(Option.fromNullishOr(alias.exec(spec)), Arr.get(1))),
    () => dependency,
  )

const optionalPeer = (manifest: PeerEdges, dependency: string): boolean =>
  pipe(
    Option.fromUndefinedOr(manifest.peerDependenciesMeta),
    Option.flatMap((meta) => Rec.get(meta, dependency)),
    Option.flatMap((entry) => Option.fromUndefinedOr(entry.optional)),
    Option.getOrElse(() => false),
  )

const installedPeers = (manifest: PeerEdges): EdgeSpecs =>
  Rec.filter(specsOf(manifest.peerDependencies), (_, dependency) => Boolean.not(optionalPeer(manifest, dependency)))

const edgesIn = (dependent: string, fields: ReadonlyArray<EdgeSpecs>): ReadonlyArray<ClosureEdge> =>
  fields.flatMap((specs) =>
    Object.entries(specs).map(([dependency, spec]) => ({ dependent, dependency, target: targetOf(dependency, spec) }))
  )

export const memberEdgesOf = (manifest: WorkspaceManifest): ReadonlyArray<ClosureEdge> =>
  edgesIn(manifest.name, [
    specsOf(manifest.dependencies),
    installedPeers(manifest),
    specsOf(manifest.optionalDependencies),
  ])

export const fixtureEdgesOf = (fixture: StagedFixtureManifest): ReadonlyArray<ClosureEdge> =>
  edgesIn(fixture.path, [
    specsOf(fixture.manifest.dependencies),
    specsOf(fixture.manifest.devDependencies),
    installedPeers(fixture.manifest),
    specsOf(fixture.manifest.optionalDependencies),
  ])

const CLOSURE_ENTRY_PACKAGES: ReadonlyArray<string> = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-svelte',
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
]

const successorsOf = (workspace: ReadonlyArray<WorkspaceManifest>, name: string): ReadonlyArray<string> =>
  pipe(
    Arr.findFirst(workspace, (manifest) => manifest.name === name),
    Option.map((manifest) => memberEdgesOf(manifest).map((edge) => edge.target)),
    Option.getOrElse((): ReadonlyArray<string> => []),
  ).filter((target) => workspace.some((manifest) => manifest.name === target))

const reachedFrom = (
  workspace: ReadonlyArray<WorkspaceManifest>,
  reached: ReadonlyArray<string>,
  frontier: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Arr.match(frontier, {
    onEmpty: () => reached,
    onNonEmpty: (names) =>
      reachedFrom(
        workspace,
        [...reached, ...names],
        Arr.difference(Arr.dedupe(names.flatMap((name) => successorsOf(workspace, name))), [...reached, ...names]),
      ),
  })

export type WorkspaceManifests = ReadonlyArray<WorkspaceManifest>

export const closureMembersOf = (workspace: WorkspaceManifests): ReadonlyArray<string> =>
  [...reachedFrom(workspace, [], CLOSURE_ENTRY_PACKAGES)].sort()
