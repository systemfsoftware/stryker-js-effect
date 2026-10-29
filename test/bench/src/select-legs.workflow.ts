import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { AffectedLegs, BaseChoice, FirstParentBase, FullCorpus, GreenBase, LegSelection } from './bench-plan.schema.js'

export class SelectLegsCommand
  extends S.TaggedClass<SelectLegsCommand, { readonly brand: unique symbol }>()('SelectLegsCommand', {
    base: BaseChoice,
    entries: S.NonEmptyArray(S.NonEmptyString),
    engineDirs: S.NonEmptyArray(S.NonEmptyString),
    changedFiles: S.Array(S.String),
    affectedPaths: S.Array(S.String),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const HARNESS_DIR = 'test/bench'

const LANE_INPUT_FILES = ['.github/workflows/bench.yml', 'flake.lock', 'flake.nix']

const LANE_INPUT_DIRS = ['.github/actions/released-tarballs/']

const isLaneInput = (file: string): boolean =>
  Boolean.or(LANE_INPUT_FILES.includes(file), LANE_INPUT_DIRS.some((dir) => file.startsWith(dir)))

const holds = (packagePath: string, entry: string): boolean =>
  Boolean.and(packagePath.length > 0, Boolean.or(entry === packagePath, entry.startsWith(`${packagePath}/`)))

const fromGreenBase = (command: SelectLegsCommand, green: GreenBase): LegSelection => {
  const laneChanged = Boolean.or(
    Arr.some(command.changedFiles, isLaneInput),
    command.affectedPaths.includes(HARNESS_DIR),
  )
  const engineChanged = Arr.some(command.affectedPaths, (path) => command.engineDirs.includes(path))
  const isAffected = (entry: string): boolean =>
    Boolean.or(engineChanged, Arr.some(command.affectedPaths, (path) => holds(path, entry)))
  return Boolean.match(laneChanged, {
    onTrue: () => FullCorpus.make({ base: green.sha, reason: 'lane-inputs-changed', legs: command.entries }),
    onFalse: (): LegSelection =>
      AffectedLegs.make({
        base: green.sha,
        legs: Arr.filter(command.entries, isAffected),
        skipped: Arr.filter(command.entries, (entry) => Boolean.not(isAffected(entry))),
      }),
  })
}

const fromFirstParentBase = (command: SelectLegsCommand, parent: FirstParentBase): LegSelection =>
  FullCorpus.make({ base: parent.sha, reason: parent.reason, legs: command.entries })

const decide = (command: SelectLegsCommand): Result.Result<LegSelection, never> =>
  Result.succeed(
    Match.valueTags(command.base, {
      GreenBase: (green) => fromGreenBase(command, green),
      FirstParentBase: (parent) => fromFirstParentBase(command, parent),
    }),
  )

export const selectLegs = Workflow.make({
  command: SelectLegsCommand,
  decision: LegSelection,
  error: S.Never,
  decide,
})

const SHA = 's'

const acceptsCommand = (fields: {
  readonly entries: ReadonlyArray<string>
  readonly engineDirs: ReadonlyArray<string>
}): boolean =>
  Result.isSuccess(
    S.decodeUnknownResult(SelectLegsCommand)({
      _tag: 'SelectLegsCommand',
      base: { _tag: 'GreenBase', sha: SHA },
      changedFiles: [],
      affectedPaths: [],
      ...fields,
    }),
  )

const VALID = { entries: [SHA], engineDirs: [SHA] }

const commandVerdicts = (value: string, count: number): ReadonlyArray<boolean> => [
  acceptsCommand({ ...VALID, entries: [value] }),
  acceptsCommand({ ...VALID, engineDirs: [value] }),
  acceptsCommand({ ...VALID, entries: Array.from({ length: count }, () => SHA) }),
  acceptsCommand({ ...VALID, engineDirs: Array.from({ length: count }, () => SHA) }),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const expectedOf = (value: string, count: number): ReadonlyArray<boolean> => [
    value.length > 0,
    value.length > 0,
    count > 0,
    count > 0,
  ]

  it.prop(
    '∀sn_SelectLegsCommandRefusal_≡NonEmptyPathsInNonEmptyLists',
    { of: [S.String, S.Int], subject: commandVerdicts },
    (subject, [drawn, drawnCount]) =>
      Arr.every(
        Arr.append(['', ' ', SHA], drawn),
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
