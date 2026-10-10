import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type ClosureEdge,
  fixtureEdgesOf,
  memberEdgesOf,
  PackedMember,
  StagedFixtureManifest,
} from './install-closure.schema.js'

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
  dependencies: S.Record(S.String, S.String),
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

const fileSpecOf = (tarballPath: string): string => `file:${tarballPath}`

const aliasesOf = (
  command: InstallClosureCommand,
  aliases: ReadonlyArray<ClosureEdge>,
): ReadonlyArray<readonly [string, string]> =>
  Arr.dedupeWith(
    aliases.flatMap((edge) =>
      Option.toArray(Option.map(tarballOf(command, edge.target), (path) => [edge.dependency, path] as const))
    ),
    ([left], [right]) => left === right,
  )

const installOf = (command: InstallClosureCommand, aliases: ReadonlyArray<ClosureEdge>): ClosureInstall => {
  const aliased = aliasesOf(command, aliases)
  return ClosureInstall.make({
    specs: [
      ...command.members.map((member) => member.tarballPath),
      ...aliased.map(([dependency, path]) => `${dependency}@file:${path}`).sort(),
    ],
    dependencies: Object.fromEntries(
      [
        ...command.members.map((member) => [member.manifest.name, fileSpecOf(member.tarballPath)] as const),
        ...aliased.map(([dependency, path]) => [dependency, fileSpecOf(path)] as const),
      ].sort(([left], [right]) => left.localeCompare(right)),
    ),
  })
}

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
