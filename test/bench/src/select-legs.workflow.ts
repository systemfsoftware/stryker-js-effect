import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { AffectedLegs, FullCorpus, type FullCorpusReason, LegSelection, NoBenchBase } from './bench-plan.schema.js'

export class SelectLegsCommand extends S.TaggedClass<SelectLegsCommand>()('SelectLegsCommand', {
  event: S.Literals(['push', 'workflow_dispatch']),
  head: S.NonEmptyString,
  greenAncestor: S.Option(S.NonEmptyString),
  firstParent: S.Option(S.NonEmptyString),
  entries: S.NonEmptyArray(S.NonEmptyString),
  engineDirs: S.NonEmptyArray(S.NonEmptyString),
  changedFiles: S.Array(S.String),
  affectedPaths: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const HARNESS_DIR = 'test/bench'

const LANE_INPUT_FILES = ['.github/workflows/bench.yml', 'flake.lock', 'flake.nix']

const LANE_INPUT_DIRS = ['.github/actions/released-tarballs/']

const isLaneInput = (file: string): boolean =>
  Boolean.or(LANE_INPUT_FILES.includes(file), LANE_INPUT_DIRS.some((dir) => file.startsWith(dir)))

const holds = (packagePath: string, entry: string): boolean =>
  Boolean.and(packagePath.length > 0, Boolean.or(entry === packagePath, entry.startsWith(`${packagePath}/`)))

const fullCorpus = (command: SelectLegsCommand, base: string, reason: FullCorpusReason): LegSelection =>
  FullCorpus.make({ base, reason, legs: command.entries })

const fromGreenAncestor = (command: SelectLegsCommand, base: string): LegSelection => {
  const laneChanged = Boolean.or(
    Arr.some(command.changedFiles, isLaneInput),
    command.affectedPaths.includes(HARNESS_DIR),
  )
  const engineChanged = Arr.some(command.affectedPaths, (path) => command.engineDirs.includes(path))
  const isAffected = (entry: string): boolean =>
    Boolean.or(engineChanged, Arr.some(command.affectedPaths, (path) => holds(path, entry)))
  return Boolean.match(laneChanged, {
    onTrue: () => fullCorpus(command, base, 'lane-inputs-changed'),
    onFalse: (): LegSelection =>
      AffectedLegs.make({
        base,
        legs: Arr.filter(command.entries, isAffected),
        skipped: Arr.filter(command.entries, (entry) => Boolean.not(isAffected(entry))),
      }),
  })
}

const fromFirstParent = (
  command: SelectLegsCommand,
  reason: FullCorpusReason,
): Result.Result<LegSelection, NoBenchBase> =>
  Option.match(command.firstParent, {
    onNone: () => Result.fail(NoBenchBase.make({ head: command.head })),
    onSome: (parent) => Result.succeed(fullCorpus(command, parent, reason)),
  })

const decide = (command: SelectLegsCommand): Result.Result<LegSelection, NoBenchBase> =>
  Boolean.match(command.event === 'workflow_dispatch', {
    onTrue: () => fromFirstParent(command, 'dispatch'),
    onFalse: () =>
      Option.match(command.greenAncestor, {
        onNone: () => fromFirstParent(command, 'no-green-ancestor'),
        onSome: (green) => Result.succeed(fromGreenAncestor(command, green)),
      }),
  })

export const selectLegs = Workflow.make({
  command: SelectLegsCommand,
  decision: LegSelection,
  error: NoBenchBase,
  decide,
})

const SHA = 's'

const acceptsCommand = (fields: {
  readonly event: string
  readonly head: string
  readonly entries: ReadonlyArray<string>
  readonly engineDirs: ReadonlyArray<string>
}): boolean =>
  Result.isSuccess(
    S.decodeUnknownResult(SelectLegsCommand)({
      _tag: 'SelectLegsCommand',
      greenAncestor: Option.none(),
      firstParent: Option.none(),
      changedFiles: [],
      affectedPaths: [],
      ...fields,
    }),
  )

const VALID = { event: 'push', head: SHA, entries: [SHA], engineDirs: [SHA] }

const commandVerdicts = (value: string, count: number): ReadonlyArray<boolean> => [
  acceptsCommand({ ...VALID, head: value }),
  acceptsCommand({ ...VALID, entries: [value] }),
  acceptsCommand({ ...VALID, engineDirs: [value] }),
  acceptsCommand({ ...VALID, event: value }),
  acceptsCommand({ ...VALID, entries: Array.from({ length: count }, () => SHA) }),
  acceptsCommand({ ...VALID, engineDirs: Array.from({ length: count }, () => SHA) }),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const events = ['push', 'workflow_dispatch']
  const expectedOf = (value: string, count: number): ReadonlyArray<boolean> => [
    value.length > 0,
    value.length > 0,
    value.length > 0,
    events.includes(value),
    count > 0,
    count > 0,
  ]

  it.prop(
    '∀sn_SelectLegsCommandRefusal_≡NonEmptyShasAndPathsAKnownEventAndNonEmptyLists',
    { of: [S.String, S.Int], subject: commandVerdicts },
    (subject, [drawn, drawnCount]) =>
      Arr.every(
        Arr.append(['', ' ', SHA, 'pull_request', ...events], drawn),
        (value) =>
          Arr.every(
            [0, 1, Math.abs(drawnCount) % 4],
            (count) =>
              Arr.every(
                Arr.zip(subject(value, count), expectedOf(value, count)),
                ([accepted, expected]) => accepted === expected,
              ),
          ),
      ),
  )
}
