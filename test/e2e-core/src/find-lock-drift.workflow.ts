import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ManifestDependencies } from './catalog-resolution.schema.js'
import { closureEntryNamesOf, type NpmLockEntry, NpmLockfile, topLevelVersionsOf } from './npm-wire.schema.js'

export const StagedLockManifest = S.Struct({
  lockKey: S.String,
  manifest: ManifestDependencies,
})
export type StagedLockManifest = typeof StagedLockManifest.Type

export class FindLockDriftCommand extends S.TaggedClass<FindLockDriftCommand>()('FindLockDriftCommand', {
  fixtureId: S.String,
  lock: S.NullOr(NpmLockfile),
  manifests: S.Array(StagedLockManifest),
  closure: S.Array(S.String),
  pins: S.Record(S.String, S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = { fixtureId: 'e2e.fixture.id' } as const
}

const LockDriftTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/LockDrift')
type LockDriftTypeId = typeof LockDriftTypeId

export class LockMissing extends S.TaggedClass<LockMissing>()('LockMissing', {
  fixtureId: S.String,
}) {
  readonly [LockDriftTypeId] = LockDriftTypeId
}

export class RootOutOfSync extends S.TaggedClass<RootOutOfSync>()('RootOutOfSync', {
  fixtureId: S.String,
  manifest: S.String,
  packageName: S.String,
}) {
  readonly [LockDriftTypeId] = LockDriftTypeId
}

export class ClosureMemberMissing extends S.TaggedClass<ClosureMemberMissing>()('ClosureMemberMissing', {
  fixtureId: S.String,
  packageName: S.String,
}) {
  readonly [LockDriftTypeId] = LockDriftTypeId
}

export class ClosureMemberExtra extends S.TaggedClass<ClosureMemberExtra>()('ClosureMemberExtra', {
  fixtureId: S.String,
  packageName: S.String,
}) {
  readonly [LockDriftTypeId] = LockDriftTypeId
}

export class PinMoved extends S.TaggedClass<PinMoved>()('PinMoved', {
  fixtureId: S.String,
  packageName: S.String,
  pinned: S.String,
  locked: S.String,
}) {
  readonly [LockDriftTypeId] = LockDriftTypeId
}

export const LockDrift = S.Union([LockMissing, RootOutOfSync, ClosureMemberMissing, ClosureMemberExtra, PinMoved])
export type LockDrift = typeof LockDrift.Type

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const NO_SPECS: Readonly<Record<string, string>> = {}

const specsOrNone = (specs: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> =>
  Option.getOrElse(Option.fromUndefinedOr(specs), () => NO_SPECS)

const pinMovesOf = (command: FindLockDriftCommand, lock: NpmLockfile): ReadonlyArray<PinMoved> => {
  const versions = topLevelVersionsOf(lock)
  return Object.entries(command.pins).flatMap(([packageName, pinned]) =>
    Option.toArray(
      Option.map(
        Option.filter(Rec.get(versions, packageName), (locked) => locked !== pinned),
        (locked) => PinMoved.make({ fixtureId: command.fixtureId, packageName, pinned, locked }),
      ),
    )
  )
}

const closureDriftOf = (
  command: FindLockDriftCommand,
  lock: NpmLockfile,
): ReadonlyArray<ClosureMemberMissing | ClosureMemberExtra> => {
  const locked = closureEntryNamesOf(lock)
  return [
    ...Arr.difference(command.closure, locked).map((packageName) =>
      ClosureMemberMissing.make({ fixtureId: command.fixtureId, packageName })
    ),
    ...Arr.difference(locked, command.closure).map((packageName) =>
      ClosureMemberExtra.make({ fixtureId: command.fixtureId, packageName })
    ),
  ]
}

const fieldDriftOf = (staged: Readonly<Record<string, string>>, locked: Readonly<Record<string, string>>) =>
  Arr.union(Object.keys(staged), Object.keys(locked)).filter((name) =>
    Option.getOrUndefined(Rec.get(staged, name)) !== Option.getOrUndefined(Rec.get(locked, name))
  )

const rootDriftOf = (
  command: FindLockDriftCommand,
  lock: NpmLockfile,
  explained: ReadonlyArray<string>,
): ReadonlyArray<RootOutOfSync> =>
  command.manifests.flatMap((staged) => {
    const entry = Option.getOrElse(Rec.get(lock.packages, staged.lockKey), (): NpmLockEntry => ({}))
    return Arr.dedupe(
      DEPENDENCY_FIELDS.flatMap((field) =>
        fieldDriftOf(specsOrNone(staged.manifest[field]), specsOrNone(entry[field]))
      ),
    )
      .filter((packageName) => !explained.includes(packageName))
      .sort()
      .map((packageName) => RootOutOfSync.make({ fixtureId: command.fixtureId, manifest: staged.lockKey, packageName }))
  })

const driftOf = (command: FindLockDriftCommand, lock: NpmLockfile): ReadonlyArray<LockDrift> => {
  const moved = pinMovesOf(command, lock)
  const closure = closureDriftOf(command, lock)
  const explained = [...moved, ...closure].map((finding) => finding.packageName)
  return [...moved, ...closure, ...rootDriftOf(command, lock, explained)]
}

const decide = (command: FindLockDriftCommand): Result.Result<ReadonlyArray<LockDrift>, never> =>
  Result.succeed(
    Option.match(Option.fromNullishOr(command.lock), {
      onNone: (): ReadonlyArray<LockDrift> => [LockMissing.make({ fixtureId: command.fixtureId })],
      onSome: (lock) => driftOf(command, lock),
    }),
  )

export const findLockDrift = Workflow.make({
  command: FindLockDriftCommand,
  decision: S.Array(LockDrift),
  error: S.Never,
  decide,
})
