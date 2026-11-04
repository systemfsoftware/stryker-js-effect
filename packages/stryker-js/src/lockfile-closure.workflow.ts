import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type LockRef,
  lockRefOf,
  packageKeyOf,
  type PnpmImporter,
  PnpmImporterSchema,
  type PnpmLockfile,
  PnpmLockfileSchema,
  type PnpmSnapshot,
  PnpmSnapshotSchema,
  SnapshotRef,
} from './pnpm-lock.schema.js'

const HoistPatterns = S.NullOr(S.Union([S.String, S.Array(S.String)]))

export const InstallSettingsSchema = S.Struct({
  hoist: S.NullOr(S.Boolean),
  hoistPattern: HoistPatterns,
  publicHoistPattern: HoistPatterns,
  nodeLinker: S.NullOr(S.String),
  shamefullyHoist: S.NullOr(S.Boolean),
  packageManager: S.NullOr(S.String),
})
export type InstallSettings = typeof InstallSettingsSchema.Type

export class LockfileDecoded
  extends S.TaggedClass<LockfileDecoded, { readonly brand: unique symbol }>()('LockfileDecoded', {
    lockfile: PnpmLockfileSchema,
  })
{}

export class LockfileUndecodable
  extends S.TaggedClass<LockfileUndecodable, { readonly brand: unique symbol }>()('LockfileUndecodable', {
    message: S.String,
  })
{}

export class InstallSettingsRead
  extends S.TaggedClass<InstallSettingsRead, { readonly brand: unique symbol }>()('InstallSettingsRead', {
    settings: InstallSettingsSchema,
  })
{}

export class InstallSettingsUnreadable
  extends S.TaggedClass<InstallSettingsUnreadable, { readonly brand: unique symbol }>()(
    'InstallSettingsUnreadable',
    { message: S.String },
  )
{}

export class PnpmLockfileRead
  extends S.TaggedClass<PnpmLockfileRead, { readonly brand: unique symbol }>()('PnpmLockfileRead', {
    text: S.String,
    lockfile: S.Union([LockfileDecoded, LockfileUndecodable]),
    importerKey: S.NullOr(S.String),
    installSettings: S.Union([InstallSettingsRead, InstallSettingsUnreadable]),
  })
{}

export class OtherLockfileRead
  extends S.TaggedClass<OtherLockfileRead, { readonly brand: unique symbol }>()('OtherLockfileRead', {
    text: S.String,
  })
{}

export class NoLockfileRead
  extends S.TaggedClass<NoLockfileRead, { readonly brand: unique symbol }>()('NoLockfileRead', {})
{}

export class LockfileClosureCommand
  extends S.TaggedClass<LockfileClosureCommand, { readonly brand: unique symbol }>()('LockfileClosureCommand', {
    source: S.Union([PnpmLockfileRead, OtherLockfileRead, NoLockfileRead]),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const LockfileClosureDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/LockfileClosureDecision')
type LockfileClosureDecisionTypeId = typeof LockfileClosureDecisionTypeId

export class LockfileClosure
  extends S.TaggedClass<LockfileClosure, { readonly brand: unique symbol }>()('LockfileClosure', {
    lockfileVersion: S.String,
    settings: S.NullOr(S.Record(S.String, S.Json)),
    installSettings: InstallSettingsSchema,
    importers: S.Record(S.String, PnpmImporterSchema),
    snapshots: S.Record(S.String, PnpmSnapshotSchema),
    packages: S.Record(S.String, S.Json),
  })
{
  readonly [LockfileClosureDecisionTypeId] = LockfileClosureDecisionTypeId
}

export const LockfileFallbackReasonSchema = S.Literals([
  'LockfileUnparseable',
  'InstallSettingsUnparseable',
  'UnsupportedLockfileVersion',
  'NoPackageManifest',
  'ImporterMissing',
  'DanglingRef',
])
export type LockfileFallbackReason = typeof LockfileFallbackReasonSchema.Type

export const LockfileFallbackSchema = S.Struct({ reason: LockfileFallbackReasonSchema, detail: S.String })
export type LockfileFallback = typeof LockfileFallbackSchema.Type

export class WholeLockfile extends S.TaggedClass<WholeLockfile, { readonly brand: unique symbol }>()('WholeLockfile', {
  text: S.String,
  fallback: S.NullOr(LockfileFallbackSchema),
}) {
  readonly [LockfileClosureDecisionTypeId] = LockfileClosureDecisionTypeId
}

export const LockfileClosureDecisionSchema = S.Union([LockfileClosure, WholeLockfile])
export type LockfileClosureDecision = typeof LockfileClosureDecisionSchema.Type

const ROOT_IMPORTER = '.'

const IMPORTER_NODE = 'importer\u0000'

const SNAPSHOT_NODE = 'snapshot\u0000'

const SUPPORTED_LOCKFILE_MAJOR = '9'

const NO_DEPENDENCIES: Readonly<Record<string, never>> = {}

const fallbackOf = (reason: LockfileFallbackReason, detail: string): LockfileFallback => ({ reason, detail })

const wholeFileOf = (text: string, fallback: LockfileFallback | null): LockfileClosureDecision =>
  WholeLockfile.make({ text, fallback })

const segmentsOf = (key: string): ReadonlyArray<string> =>
  key.split('/').filter((segment) => Boolean.and(segment !== '', segment !== '.'))

const climbed = (segments: ReadonlyArray<string>, segment: string): ReadonlyArray<string> =>
  Option.match(Option.filter(Arr.last(segments), (last) => last !== '..'), {
    onNone: () => [...segments, segment],
    onSome: () => segments.slice(0, -1),
  })

const steppedInto = (segments: ReadonlyArray<string>, segment: string): ReadonlyArray<string> =>
  Boolean.match(segment === '..', { onTrue: () => climbed(segments, segment), onFalse: () => [...segments, segment] })

const keyOfSegments = (segments: ReadonlyArray<string>): string =>
  Option.getOrElse(Option.liftPredicate(segments.join('/'), (joined) => joined !== ''), () => ROOT_IMPORTER)

const linkedImporterOf = (from: string, target: string): string =>
  keyOfSegments(Arr.reduce(segmentsOf(target), segmentsOf(from), steppedInto))

const ancestorsOf = (importerKey: string): ReadonlyArray<string> => {
  const segments = segmentsOf(importerKey)
  return Arr.map(Arr.range(0, segments.length), (depth) => keyOfSegments(segments.slice(0, depth)))
}

const nodeOfRef = (from: string, ref: LockRef): string =>
  Match.valueTags(ref, {
    LinkRef: ({ target }) => `${IMPORTER_NODE}${linkedImporterOf(from, target)}`,
    SnapshotRef: ({ key }) => `${SNAPSHOT_NODE}${key}`,
  })

const refNodesOf = (from: string, refs: Readonly<Record<string, string>>): ReadonlyArray<string> =>
  Object.entries(refs).map(([name, ref]) => nodeOfRef(from, lockRefOf(ref, name)))

const versionsOf = (
  dependencies: PnpmImporter['dependencies'],
): Readonly<Record<string, string>> =>
  Rec.map(Option.getOrElse(Option.fromUndefinedOr(dependencies), () => NO_DEPENDENCIES), (entry) => entry.version)

const refsOrNone = (refs: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> =>
  Option.getOrElse(Option.fromUndefinedOr(refs), () => NO_DEPENDENCIES)

const importerSuccessorsOf = (key: string, importer: PnpmImporter): ReadonlyArray<string> =>
  [importer.dependencies, importer.devDependencies, importer.optionalDependencies].flatMap((dependencies) =>
    refNodesOf(key, versionsOf(dependencies))
  )

const snapshotSuccessorsOf = (snapshot: PnpmSnapshot): ReadonlyArray<string> =>
  [snapshot.dependencies, snapshot.optionalDependencies].flatMap((refs) => refNodesOf(ROOT_IMPORTER, refsOrNone(refs)))

const snapshotsOf = (lockfile: PnpmLockfile): Readonly<Record<string, PnpmSnapshot>> =>
  Option.getOrElse(Option.fromUndefinedOr(lockfile.snapshots), () => NO_DEPENDENCIES)

const packagesOf = (lockfile: PnpmLockfile): Readonly<Record<string, S.Json>> =>
  Option.getOrElse(Option.fromUndefinedOr(lockfile.packages), () => NO_DEPENDENCIES)

const keyOfNode = (node: string, kind: string): Option.Option<string> =>
  Option.map(Option.liftPredicate(node, (candidate) => candidate.startsWith(kind)), (kept) => kept.slice(kind.length))

const successorsOf = (lockfile: PnpmLockfile, node: string): ReadonlyArray<string> =>
  Option.getOrElse(
    Option.orElse(
      Option.flatMap(keyOfNode(node, IMPORTER_NODE), (key) =>
        Option.map(Rec.get(lockfile.importers, key), (importer) => importerSuccessorsOf(key, importer))),
      () =>
        Option.flatMap(
          keyOfNode(node, SNAPSHOT_NODE),
          (key) =>
            Option.map(Rec.get(snapshotsOf(lockfile), key), snapshotSuccessorsOf),
        ),
    ),
    () => [],
  )

const reachedFrom = (
  lockfile: PnpmLockfile,
  seen: HashSet.HashSet<string>,
  frontier: ReadonlyArray<string>,
): HashSet.HashSet<string> => {
  const next = Arr.dedupe(frontier.flatMap((node) => successorsOf(lockfile, node))).filter((node) =>
    !HashSet.has(seen, node)
  )
  return Boolean.match(Arr.isReadonlyArrayNonEmpty(next), {
    onTrue: () => reachedFrom(lockfile, HashSet.union(seen, HashSet.fromIterable(next)), next),
    onFalse: () => seen,
  })
}

const startNodesOf = (lockfile: PnpmLockfile, importerKey: string): ReadonlyArray<string> =>
  [importerKey, ...ancestorsOf(importerKey).filter((ancestor) => Rec.has(lockfile.importers, ancestor))].map((key) =>
    `${IMPORTER_NODE}${key}`
  )

const keysOfKind = (nodes: HashSet.HashSet<string>, kind: string): ReadonlyArray<string> =>
  Arr.getSomes([...nodes].map((node) => keyOfNode(node, kind)))

const packageKeyOfSnapshot = (key: string): string => packageKeyOf(SnapshotRef.make({ key }))

const danglingSnapshotOf = (lockfile: PnpmLockfile, key: string): Option.Option<string> =>
  Option.liftPredicate(
    `snapshot "${key}"`,
    () =>
      Boolean.not(
        Boolean.and(Rec.has(snapshotsOf(lockfile), key), Rec.has(packagesOf(lockfile), packageKeyOfSnapshot(key))),
      ),
  )

const danglingImporterOf = (lockfile: PnpmLockfile, key: string): Option.Option<string> =>
  Option.liftPredicate(`importer "${key}"`, () => Boolean.not(Rec.has(lockfile.importers, key)))

const danglingOf = (lockfile: PnpmLockfile, nodes: HashSet.HashSet<string>): Option.Option<LockfileFallback> =>
  Option.map(
    Option.firstSomeOf([
      ...keysOfKind(nodes, IMPORTER_NODE).map((key) => danglingImporterOf(lockfile, key)),
      ...keysOfKind(nodes, SNAPSHOT_NODE).map((key) => danglingSnapshotOf(lockfile, key)),
    ]),
    (ref) => fallbackOf('DanglingRef', `${ref} is referenced but the lockfile has no entry for it`),
  )

const pickedFrom = <A>(record: Readonly<Record<string, A>>, keys: ReadonlyArray<string>): Readonly<Record<string, A>> =>
  Object.fromEntries(
    Arr.getSomes(keys.map((key) => Option.map(Rec.get(record, key), (entry) => [key, entry] as const))),
  )

const closureOf = (
  lockfile: PnpmLockfile,
  installSettings: InstallSettings,
  nodes: HashSet.HashSet<string>,
): LockfileClosureDecision => {
  const snapshotKeys = keysOfKind(nodes, SNAPSHOT_NODE)
  return LockfileClosure.make({
    lockfileVersion: lockfile.lockfileVersion,
    settings: Option.getOrNull(Option.fromUndefinedOr(lockfile.settings)),
    installSettings,
    importers: pickedFrom(lockfile.importers, keysOfKind(nodes, IMPORTER_NODE)),
    snapshots: pickedFrom(snapshotsOf(lockfile), snapshotKeys),
    packages: pickedFrom(packagesOf(lockfile), snapshotKeys.map(packageKeyOfSnapshot)),
  })
}

const walkedFrom = (
  read: PnpmLockfileRead,
  lockfile: PnpmLockfile,
  installSettings: InstallSettings,
  importerKey: string,
): LockfileClosureDecision => {
  const start = startNodesOf(lockfile, importerKey)
  const nodes = reachedFrom(lockfile, HashSet.fromIterable(start), start)
  return Option.match(danglingOf(lockfile, nodes), {
    onSome: (fallback) => wholeFileOf(read.text, fallback),
    onNone: () => closureOf(lockfile, installSettings, nodes),
  })
}

const unsupportedVersionOf = (lockfile: PnpmLockfile): Option.Option<LockfileFallback> =>
  Option.map(
    Option.liftPredicate(lockfile.lockfileVersion, (version) => version.split('.')[0] !== SUPPORTED_LOCKFILE_MAJOR),
    (version) =>
      fallbackOf('UnsupportedLockfileVersion', `lockfileVersion ${version} is not ${SUPPORTED_LOCKFILE_MAJOR}.x`),
  )

const importerMissingOf = (lockfile: PnpmLockfile, importerKey: string): Option.Option<LockfileFallback> =>
  Option.map(
    Option.liftPredicate(importerKey, (key) => Boolean.not(Rec.has(lockfile.importers, key))),
    (key) => fallbackOf('ImporterMissing', `the lockfile has no importer "${key}"`),
  )

const importerDecisionOf = (
  read: PnpmLockfileRead,
  lockfile: PnpmLockfile,
  installSettings: InstallSettings,
): LockfileClosureDecision =>
  Option.match(Option.fromNullOr(read.importerKey), {
    onNone: () =>
      wholeFileOf(read.text, fallbackOf('NoPackageManifest', 'no package.json was found above the project directory')),
    onSome: (importerKey) =>
      Option.match(importerMissingOf(lockfile, importerKey), {
        onSome: (fallback) => wholeFileOf(read.text, fallback),
        onNone: () => walkedFrom(read, lockfile, installSettings, importerKey),
      }),
  })

const decodedDecisionOf = (
  read: PnpmLockfileRead,
  lockfile: PnpmLockfile,
  installSettings: InstallSettings,
): LockfileClosureDecision =>
  Option.match(unsupportedVersionOf(lockfile), {
    onSome: (fallback) => wholeFileOf(read.text, fallback),
    onNone: () => importerDecisionOf(read, lockfile, installSettings),
  })

const pnpmDecisionOf = (read: PnpmLockfileRead): LockfileClosureDecision =>
  Match.valueTags(read.lockfile, {
    LockfileUndecodable: ({ message }) => wholeFileOf(read.text, fallbackOf('LockfileUnparseable', message)),
    LockfileDecoded: ({ lockfile }) =>
      Match.valueTags(read.installSettings, {
        InstallSettingsUnreadable: ({ message }) =>
          wholeFileOf(read.text, fallbackOf('InstallSettingsUnparseable', message)),
        InstallSettingsRead: ({ settings }) => decodedDecisionOf(read, lockfile, settings),
      }),
  })

const decide = (command: LockfileClosureCommand): LockfileClosureDecision =>
  Match.valueTags(command.source, {
    PnpmLockfileRead: pnpmDecisionOf,
    OtherLockfileRead: ({ text }) => wholeFileOf(text, null),
    NoLockfileRead: () => wholeFileOf('', null),
  })

export const lockfileClosure = Workflow.make({
  command: LockfileClosureCommand,
  decision: LockfileClosureDecisionSchema,
  error: S.Never,
  decide: (command): Result.Result<LockfileClosureDecision, never> => Result.succeed(decide(command)),
})
