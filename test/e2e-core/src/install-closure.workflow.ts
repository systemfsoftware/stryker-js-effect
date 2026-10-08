import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type PackedManifest, PackedMember, StagedFixtureManifest } from './install-closure.schema.js'

export class InstallClosureCommand extends S.TaggedClass<InstallClosureCommand>()('InstallClosureCommand', {
  members: S.Array(PackedMember),
  fixtures: S.Array(StagedFixtureManifest),
  workspace: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const ClosureInstallTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/ClosureInstall')
type ClosureInstallTypeId = typeof ClosureInstallTypeId

export class ClosureInstall extends S.TaggedClass<ClosureInstall>()('ClosureInstall', {
  specs: S.Array(S.String),
}) {
  readonly [ClosureInstallTypeId] = ClosureInstallTypeId
}

export class UnpackedWorkspaceDependency extends S.TaggedError<UnpackedWorkspaceDependency>()(
  'UnpackedWorkspaceDependency',
  {
    dependent: S.String,
    dependency: S.String,
    target: S.String,
  },
) {
  override get message(): string {
    return `${this.dependent} depends on the workspace package ${this.target} as "${this.dependency}", but the packed closure carries no tarball for it, so npm would resolve it from the registry`
  }
}

export class ConflictingAliasTargets extends S.TaggedError<ConflictingAliasTargets>()('ConflictingAliasTargets', {
  dependency: S.String,
  targets: S.Array(S.String),
}) {
  override get message(): string {
    return `the packed closure installs "${this.dependency}" as more than one package (${
      this.targets.join(', ')
    }); npm keeps whichever spec comes last, so every other dependent would get the wrong package`
  }
}

export class FixtureNamesWorkspacePackage extends S.TaggedError<FixtureNamesWorkspacePackage>()(
  'FixtureNamesWorkspacePackage',
  {
    fixture: S.String,
    dependency: S.String,
    target: S.String,
  },
) {
  override get message(): string {
    return `${this.fixture} depends on the workspace package ${this.target} as "${this.dependency}", but the fixture's own npm install resolves it from the registry; the bake installs the packed closure into every fixture, so drop the edge`
  }
}

export const InstallClosureFailure = S.Union([
  UnpackedWorkspaceDependency,
  ConflictingAliasTargets,
  FixtureNamesWorkspacePackage,
])
export type InstallClosureFailure = typeof InstallClosureFailure.Type

interface ClosureEdge {
  readonly dependent: string
  readonly dependency: string
  readonly target: string
}

type EdgeSpecs = Readonly<Record<string, string>>

type PeerEdges = Pick<PackedManifest, 'peerDependencies' | 'peerDependenciesMeta'>

const NPM_ALIAS = /^npm:((?:@[^/@]+\/)?[^/@]+)(?:@.*)?$/

const NO_EDGES: EdgeSpecs = {}

const specsOf = (specs: EdgeSpecs | undefined): EdgeSpecs =>
  Option.getOrElse(Option.fromUndefinedOr(specs), () => NO_EDGES)

const targetOf = (dependency: string, spec: string): string =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(NPM_ALIAS.exec(spec)), (match) => Arr.get(match, 1)),
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

const memberEdgesOf = (manifest: PackedManifest): ReadonlyArray<ClosureEdge> =>
  edgesIn(manifest.name, [
    specsOf(manifest.dependencies),
    installedPeers(manifest),
    specsOf(manifest.optionalDependencies),
  ])

const fixtureEdgesOf = (fixture: StagedFixtureManifest): ReadonlyArray<ClosureEdge> =>
  edgesIn(fixture.path, [
    specsOf(fixture.manifest.dependencies),
    specsOf(fixture.manifest.devDependencies),
    installedPeers(fixture.manifest),
    specsOf(fixture.manifest.optionalDependencies),
  ])

const tarballOf = (command: InstallClosureCommand, name: string): Option.Option<string> =>
  Option.map(
    Arr.findFirst(command.members, (member) => member.manifest.name === name),
    (member) => member.tarballPath,
  )

const unpacked = (command: InstallClosureCommand, edge: ClosureEdge): boolean =>
  Boolean.and(command.workspace.includes(edge.target), Option.isNone(tarballOf(command, edge.target)))

const isAlias = (edge: ClosureEdge): boolean => edge.target !== edge.dependency

const targetsOf = (
  command: InstallClosureCommand,
  aliases: ReadonlyArray<ClosureEdge>,
  dependency: string,
): ReadonlyArray<string> =>
  Arr.dedupe([
    ...aliases.filter((edge) => edge.dependency === dependency).map((edge) => edge.target),
    ...Option.toArray(Option.map(tarballOf(command, dependency), () => dependency)),
  ]).sort()

const fixtureRefusal = (command: InstallClosureCommand): Result.Result<void, FixtureNamesWorkspacePackage> =>
  Option.match(
    Arr.findFirst(command.fixtures.flatMap(fixtureEdgesOf), (edge) => command.workspace.includes(edge.target)),
    {
      onNone: () => Result.succeed(undefined),
      onSome: (edge) =>
        Result.fail(
          FixtureNamesWorkspacePackage.make({
            fixture: edge.dependent,
            dependency: edge.dependency,
            target: edge.target,
          }),
        ),
    },
  )

const unpackedRefusal = (
  command: InstallClosureCommand,
  edges: ReadonlyArray<ClosureEdge>,
): Result.Result<void, UnpackedWorkspaceDependency> =>
  Option.match(Arr.findFirst(edges, (edge) => unpacked(command, edge)), {
    onNone: () => Result.succeed(undefined),
    onSome: (edge) => Result.fail(UnpackedWorkspaceDependency.make(edge)),
  })

const conflictRefusal = (
  command: InstallClosureCommand,
  aliases: ReadonlyArray<ClosureEdge>,
): Result.Result<void, ConflictingAliasTargets> =>
  Option.match(
    Arr.findFirst(
      Arr.dedupe(aliases.map((edge) => edge.dependency)),
      (dependency) => targetsOf(command, aliases, dependency).length > 1,
    ),
    {
      onNone: () => Result.succeed(undefined),
      onSome: (dependency) =>
        Result.fail(ConflictingAliasTargets.make({ dependency, targets: targetsOf(command, aliases, dependency) })),
    },
  )

const aliasSpecOf = (command: InstallClosureCommand, edge: ClosureEdge): ReadonlyArray<string> =>
  Option.toArray(Option.map(tarballOf(command, edge.target), (path) => `${edge.dependency}@file:${path}`))

const installOf = (command: InstallClosureCommand, aliases: ReadonlyArray<ClosureEdge>): ClosureInstall =>
  ClosureInstall.make({
    specs: [
      ...command.members.map((member) => member.tarballPath),
      ...Arr.dedupe(aliases.flatMap((edge) => aliasSpecOf(command, edge))).sort(),
    ],
  })

const decide = (command: InstallClosureCommand): Result.Result<ClosureInstall, InstallClosureFailure> => {
  const edges = command.members.flatMap((member) => memberEdgesOf(member.manifest))
  const aliases = edges.filter(isAlias)
  return pipe(
    fixtureRefusal(command),
    Result.flatMap((): Result.Result<void, InstallClosureFailure> => unpackedRefusal(command, edges)),
    Result.flatMap((): Result.Result<void, InstallClosureFailure> => conflictRefusal(command, aliases)),
    Result.map(() => installOf(command, aliases)),
  )
}

export const installClosure = Workflow.make({
  command: InstallClosureCommand,
  decision: ClosureInstall,
  error: InstallClosureFailure,
  decide,
})
