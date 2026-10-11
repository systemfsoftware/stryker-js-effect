import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type InstallSettings,
  InstallSettingsRead,
  InstallSettingsUnreadable,
  LockfileClosure,
  lockfileClosure,
  LockfileClosureCommand,
  type LockfileClosureDecision,
  LockfileClosureDecisionSchema,
  LockfileDecoded,
  type LockfileFallbackReason,
  LockfileUndecodable,
  NoLockfileRead,
  OtherLockfileRead,
  PnpmLockfileRead,
  WholeLockfile,
} from '../lockfile-closure.workflow.js'
import {
  type PnpmImporter,
  type PnpmImporterDependency,
  type PnpmLockfile,
  PnpmLockfileSchema,
  type PnpmSnapshot,
} from '../pnpm-lock.schema.js'

const IMPORTERS = ['.', 'a', 'b', 'c/d'] as const

type Subject = (command: LockfileClosureCommand) => Result.Result<LockfileClosureDecision, never>

type Refs = Readonly<Record<string, string>>

type ImporterRefs = Readonly<Record<string, PnpmImporterDependency>>

const sameDecision = (left: LockfileClosureDecision, right: LockfileClosureDecision): boolean =>
  S.toEquivalence(LockfileClosureDecisionSchema)(left, right)

const DEFAULT_INSTALL: InstallSettings = {
  hoist: null,
  hoistPattern: null,
  publicHoistPattern: null,
  nodeLinker: null,
  shamefullyHoist: null,
  packageManager: 'pnpm@11.27.0',
}

const INSTALL_CHANGES: ReadonlyArray<Partial<InstallSettings>> = [
  { hoist: false },
  { hoistPattern: ['*eslint*'] },
  { publicHoistPattern: '*types*' },
  { nodeLinker: 'hoisted' },
  { shamefullyHoist: true },
  { packageManager: 'pnpm@11.28.0' },
]

const slotOf = (drawn: number, length: number): number => ((drawn % length) + length) % length

const importerAt = (drawn: number): string => IMPORTERS[slotOf(drawn, IMPORTERS.length)] ?? '.'

const hashOf = (name: string): number =>
  Array.from(name, (char) => char.codePointAt(0) ?? 0).reduce((sum, point) => sum + point, 0)

const versionOf = (index: number, bumped: number | null): string => (index === bumped ? '2.0.0' : '1.0.0')

const snapshotKeyOf = (index: number, bumped: number | null = null): string => `p${index}@${versionOf(index, bumped)}`

const snapshotCountOf = (drawn: PnpmLockfile): number => Object.keys(drawn.snapshots ?? {}).length

const targetsOf = (drawn: PnpmLockfile, names: ReadonlyArray<string>): ReadonlyArray<number> =>
  snapshotCountOf(drawn) === 0 ? [] : names.map((name) => slotOf(hashOf(name), snapshotCountOf(drawn)))

const snapshotRefsOf = (drawn: PnpmLockfile, refs: Refs | undefined, bumped: number | null): Refs =>
  Object.fromEntries(targetsOf(drawn, Object.keys(refs ?? {})).map((index) => [`p${index}`, versionOf(index, bumped)]))

const importerRefsOf = (drawn: PnpmLockfile, refs: ImporterRefs | undefined, bumped: number | null): ImporterRefs => {
  const entries = Object.values(refs ?? {})
  return Object.fromEntries(
    targetsOf(drawn, Object.keys(refs ?? {})).map((index, at) => [
      `p${index}`,
      { ...entries[at], specifier: entries[at]?.specifier ?? '', version: versionOf(index, bumped) },
    ]),
  )
}

const importerOf = (drawn: PnpmLockfile, importer: PnpmImporter, bumped: number | null): PnpmImporter => ({
  ...importer,
  dependencies: importerRefsOf(drawn, importer.dependencies, bumped),
  devDependencies: importerRefsOf(drawn, importer.devDependencies, bumped),
  optionalDependencies: importerRefsOf(drawn, importer.optionalDependencies, bumped),
})

const snapshotOf = (drawn: PnpmLockfile, snapshot: PnpmSnapshot, bumped: number | null): PnpmSnapshot => ({
  ...snapshot,
  dependencies: snapshotRefsOf(drawn, snapshot.dependencies, bumped),
  optionalDependencies: snapshotRefsOf(drawn, snapshot.optionalDependencies, bumped),
})

const consistentOf = (drawn: PnpmLockfile, bumped: number | null = null): PnpmLockfile => {
  const importers = Object.values(drawn.importers)
  const snapshots = Object.values(drawn.snapshots ?? {})
  const packages = Object.values(drawn.packages ?? {})
  return {
    ...drawn,
    lockfileVersion: '9.0',
    importers: Object.fromEntries(
      IMPORTERS.map((key, at) => [key, importerOf(drawn, importers[at] ?? {}, bumped)]),
    ),
    snapshots: Object.fromEntries(
      snapshots.map((snapshot, index) => [snapshotKeyOf(index, bumped), snapshotOf(drawn, snapshot, bumped)]),
    ),
    packages: Object.fromEntries(snapshots.map((_, index) => [snapshotKeyOf(index, bumped), packages[index] ?? {}])),
  }
}

const readOf = (
  lockfile: PnpmLockfile,
  importerKey: string | null,
  install: InstallSettings = DEFAULT_INSTALL,
): LockfileClosureCommand =>
  LockfileClosureCommand.make({
    source: PnpmLockfileRead.make({
      text: JSON.stringify(lockfile),
      lockfile: LockfileDecoded.make({ lockfile }),
      importerKey,
      installSettings: InstallSettingsRead.make({ settings: install }),
    }),
  })

const decisionOf = (subject: Subject, command: LockfileClosureCommand): LockfileClosureDecision =>
  Result.getOrThrow(subject(command))

const closureOf = (decision: LockfileClosureDecision): Option.Option<LockfileClosure> =>
  Option.liftPredicate(decision, S.is(LockfileClosure))

const reasonOf = (decision: LockfileClosureDecision): LockfileFallbackReason | null =>
  Option.match(Option.liftPredicate(decision, S.is(WholeLockfile)), {
    onNone: () => null,
    onSome: (whole) => whole.fallback?.reason ?? null,
  })

const withImporter = (lockfile: PnpmLockfile, key: string, importer: PnpmImporter): PnpmLockfile => ({
  ...lockfile,
  importers: { ...lockfile.importers, [key]: importer },
})

const withSnapshots = (lockfile: PnpmLockfile, added: Readonly<Record<string, PnpmSnapshot>>): PnpmLockfile => ({
  ...lockfile,
  snapshots: { ...lockfile.snapshots, ...added },
  packages: { ...lockfile.packages, ...Object.fromEntries(Object.keys(added).map((key) => [key, {}])) },
})

const movedWhenReached = (
  before: LockfileClosureDecision,
  after: LockfileClosureDecision,
  reached: (closure: LockfileClosure) => boolean,
): boolean =>
  Option.match(closureOf(before), {
    onNone: () => false,
    onSome: (closure) =>
      Boolean.and(Option.isSome(closureOf(after)), !sameDecision(before, after) === reached(closure)),
  })

const movedAndClosed = (before: LockfileClosureDecision, after: LockfileClosureDecision): boolean =>
  Boolean.every([Option.isSome(closureOf(before)), Option.isSome(closureOf(after)), !sameDecision(before, after)])

const brokenReadsOf = (
  lockfile: PnpmLockfile,
  project: string,
): ReadonlyArray<readonly [LockfileClosureCommand, LockfileFallbackReason]> => [
  [
    LockfileClosureCommand.make({
      source: PnpmLockfileRead.make({
        text: 'importers: [',
        lockfile: LockfileUndecodable.make({ message: 'unexpected end of flow sequence' }),
        importerKey: project,
        installSettings: InstallSettingsRead.make({ settings: DEFAULT_INSTALL }),
      }),
    }),
    'LockfileUnparseable',
  ],
  [
    LockfileClosureCommand.make({
      source: PnpmLockfileRead.make({
        text: JSON.stringify(lockfile),
        lockfile: LockfileDecoded.make({ lockfile }),
        importerKey: project,
        installSettings: InstallSettingsUnreadable.make({ message: 'hoist: expected boolean' }),
      }),
    }),
    'InstallSettingsUnparseable',
  ],
  [readOf({ ...lockfile, lockfileVersion: '6.0' }, project), 'UnsupportedLockfileVersion'],
  [readOf(lockfile, null), 'NoPackageManifest'],
  [readOf(lockfile, 'missing/importer'), 'ImporterMissing'],
  [
    readOf(withImporter(lockfile, project, { dependencies: { ghost: { specifier: '1', version: '1.0.0' } } }), project),
    'DanglingRef',
  ],
  [
    readOf(
      withImporter(
        { ...lockfile, snapshots: { ...lockfile.snapshots, 'orphan@1.0.0': {} } },
        project,
        { dependencies: { orphan: { specifier: '1', version: '1.0.0' } } },
      ),
      project,
    ),
    'DanglingRef',
  ],
  [
    readOf(
      withImporter(lockfile, project, {
        dependencies: { stray: { specifier: 'link:./not-a-project', version: 'link:./not-a-project' } },
      }),
      project,
    ),
    'DanglingRef',
  ],
]

describe('lockfileClosure', () => {
  it.prop(
    '∀l_UnlinkedImporter_≡DecisionUnchanged',
    { of: [PnpmLockfileSchema, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject]) => {
      const lockfile = consistentOf(drawn)
      const project = importerAt(drawnProject)
      const unlinked = importerOf(drawn, Option.getOrElse(Arr.last(Object.values(drawn.importers)), () => ({})), null)
      const before = decisionOf(subject, readOf(lockfile, project))
      const after = decisionOf(subject, readOf(withImporter(lockfile, 'z/new', unlinked), project))
      return Boolean.and(Option.isSome(closureOf(before)), sameDecision(before, after))
    },
  )

  it.prop(
    '∀l_SnapshotVersion_≡MovesExactlyTheReachingProjects',
    { of: [PnpmLockfileSchema, S.Int, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject, drawnSnapshot]) => {
      const project = importerAt(drawnProject)
      const index = slotOf(drawnSnapshot, Math.max(1, snapshotCountOf(drawn)))
      return movedWhenReached(
        decisionOf(subject, readOf(consistentOf(drawn), project)),
        decisionOf(subject, readOf(consistentOf(drawn, index), project)),
        (closure) => Object.hasOwn(closure.snapshots, snapshotKeyOf(index)),
      )
    },
  )

  it.prop(
    '∀l_PackageIntegrity_≡MovesExactlyTheReachingProjects',
    { of: [PnpmLockfileSchema, S.Int, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject, drawnSnapshot]) => {
      const lockfile = consistentOf(drawn)
      const project = importerAt(drawnProject)
      const key = snapshotKeyOf(slotOf(drawnSnapshot, Math.max(1, snapshotCountOf(drawn))))
      const repacked = {
        ...lockfile,
        packages: { ...lockfile.packages, [key]: { resolution: { integrity: 'sha512-repacked' } } },
      }
      return movedWhenReached(
        decisionOf(subject, readOf(lockfile, project)),
        decisionOf(subject, readOf(repacked, project)),
        (closure) => Object.hasOwn(closure.snapshots, key),
      )
    },
  )

  it.prop(
    '∀l_RootDevDependency_≡MovesEveryProject',
    { of: [PnpmLockfileSchema, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject]) => {
      const lockfile = consistentOf(drawn)
      const project = importerAt(drawnProject)
      const root = lockfile.importers['.'] ?? {}
      const moved = withImporter(withSnapshots(lockfile, { 'root-tool@9.9.9': {} }), '.', {
        ...root,
        devDependencies: { ...root.devDependencies, 'root-tool': { specifier: '9.9.9', version: '9.9.9' } },
      })
      return movedAndClosed(decisionOf(subject, readOf(lockfile, project)), decisionOf(subject, readOf(moved, project)))
    },
  )

  it.prop(
    '∀l_LinkedImporter_≡PullsInItsDevDependencies',
    { of: [PnpmLockfileSchema], subject: lockfileClosure },
    (subject, [drawn]) => {
      const lockfile = withSnapshots(consistentOf(drawn), { 'dev-only@1.0.0': {} })
      const linked = withImporter(
        withImporter(lockfile, 'b', {
          ...lockfile.importers['b'],
          devDependencies: { 'dev-only': { specifier: '1.0.0', version: '1.0.0' } },
        }),
        'a',
        { ...lockfile.importers['a'], dependencies: { 'link-b': { specifier: 'link:../b', version: 'link:../b' } } },
      )
      return Option.exists(
        closureOf(decisionOf(subject, readOf(linked, 'a'))),
        (closure) =>
          Boolean.and(Object.hasOwn(closure.importers, 'b'), Object.hasOwn(closure.snapshots, 'dev-only@1.0.0')),
      )
    },
  )

  it.prop(
    '∀l_SnapshotCycle_≡TerminatesWithBothSnapshots',
    { of: [PnpmLockfileSchema, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject]) => {
      const project = importerAt(drawnProject)
      const lockfile = withSnapshots(consistentOf(drawn), {
        'left@1.0.0': { dependencies: { right: '1.0.0' } },
        'right@1.0.0': { dependencies: { left: '1.0.0' } },
      })
      const cyclic = withImporter(lockfile, project, {
        ...lockfile.importers[project],
        optionalDependencies: { left: { specifier: '1.0.0', version: '1.0.0' } },
      })
      return Option.exists(
        closureOf(decisionOf(subject, readOf(cyclic, project))),
        (closure) =>
          Boolean.and(Object.hasOwn(closure.snapshots, 'left@1.0.0'), Object.hasOwn(closure.snapshots, 'right@1.0.0')),
      )
    },
  )

  it.prop(
    '∀l_UnusableLockfile_≡WholeFileWithItsReason',
    { of: [PnpmLockfileSchema, S.Int, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject, drawnRow]) => {
      const rows = brokenReadsOf(consistentOf(drawn), importerAt(drawnProject))
      return Option.exists(
        Arr.get(rows, slotOf(drawnRow, rows.length)),
        ([command, reason]) => reasonOf(decisionOf(subject, command)) === reason,
      )
    },
  )

  it.prop(
    '∀l_InstallSetting_≡MovesEveryProject',
    { of: [PnpmLockfileSchema, S.Int, S.Int], subject: lockfileClosure },
    (subject, [drawn, drawnProject, drawnChange]) => {
      const lockfile = consistentOf(drawn)
      const project = importerAt(drawnProject)
      const change = INSTALL_CHANGES[slotOf(drawnChange, INSTALL_CHANGES.length)] ?? {}
      return movedAndClosed(
        decisionOf(subject, readOf(lockfile, project)),
        decisionOf(subject, readOf(lockfile, project, { ...DEFAULT_INSTALL, ...change })),
      )
    },
  )

  it.prop(
    '∀t_OtherOrNoLockfile_≡WholeFileWithoutReason',
    { of: [S.String], subject: lockfileClosure },
    (subject, [text]) =>
      Boolean.and(
        sameDecision(
          decisionOf(subject, LockfileClosureCommand.make({ source: OtherLockfileRead.make({ text }) })),
          WholeLockfile.make({ text, fallback: null }),
        ),
        sameDecision(
          decisionOf(subject, LockfileClosureCommand.make({ source: NoLockfileRead.make({}) })),
          WholeLockfile.make({ text: '', fallback: null }),
        ),
      ),
  )
})
