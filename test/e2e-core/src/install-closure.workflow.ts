import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type PackedManifest, PackedMember } from './bake-key.schema.js'

export class InstallClosureCommand extends S.TaggedClass<InstallClosureCommand>()('InstallClosureCommand', {
  members: S.Array(PackedMember),
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

interface ClosureEdge {
  readonly dependent: string
  readonly dependency: string
  readonly target: string
}

const NPM_ALIAS = /^npm:((?:@[^/@]+\/)?[^/@]+)(?:@.*)?$/

const NO_EDGES: Readonly<Record<string, string>> = {}

const targetOf = (dependency: string, spec: string): string =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(NPM_ALIAS.exec(spec)), (match) => Arr.get(match, 1)),
    () => dependency,
  )

const edgesOf = (manifest: PackedManifest): ReadonlyArray<ClosureEdge> =>
  [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies].flatMap((specs) =>
    Object.entries(Option.getOrElse(Option.fromUndefinedOr(specs), () => NO_EDGES)).map(([dependency, spec]) => ({
      dependent: manifest.name,
      dependency,
      target: targetOf(dependency, spec),
    }))
  )

const tarballOf = (command: InstallClosureCommand, name: string): Option.Option<string> =>
  Option.map(
    Arr.findFirst(command.members, (member) => member.manifest.name === name),
    (member) => member.tarballPath,
  )

const unpacked = (command: InstallClosureCommand, edge: ClosureEdge): boolean =>
  Boolean.and(command.workspace.includes(edge.target), Option.isNone(tarballOf(command, edge.target)))

const aliasSpecOf = (command: InstallClosureCommand, edge: ClosureEdge): ReadonlyArray<string> =>
  Boolean.match(edge.target === edge.dependency, {
    onTrue: () => [],
    onFalse: () =>
      Option.toArray(Option.map(tarballOf(command, edge.target), (path) => `${edge.dependency}@file:${path}`)),
  })

const installOf = (command: InstallClosureCommand, edges: ReadonlyArray<ClosureEdge>): ClosureInstall =>
  ClosureInstall.make({
    specs: [
      ...command.members.map((member) => member.tarballPath),
      ...Arr.dedupe(edges.flatMap((edge) => aliasSpecOf(command, edge))).sort(),
    ],
  })

const decide = (command: InstallClosureCommand): Result.Result<ClosureInstall, UnpackedWorkspaceDependency> => {
  const edges = command.members.flatMap((member) => edgesOf(member.manifest))
  return Option.match(Arr.findFirst(edges, (edge) => unpacked(command, edge)), {
    onNone: () => Result.succeed(installOf(command, edges)),
    onSome: (edge) => Result.fail(UnpackedWorkspaceDependency.make(edge)),
  })
}

export const installClosure = Workflow.make({
  command: InstallClosureCommand,
  decision: ClosureInstall,
  error: UnpackedWorkspaceDependency,
  decide,
})
