import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { AffectedLegs, FullCorpus, type LegSelection, NoBenchBase } from '../bench-plan.schema.js'
import { selectLegs, SelectLegsCommand } from '../select-legs.workflow.js'

const ENTRIES = ['packages/a', 'packages/b', 'test/e2e/fixture'] as const
const OWNER: Readonly<Record<(typeof ENTRIES)[number], string>> = {
  'packages/a': 'packages/a',
  'packages/b': 'packages/b',
  'test/e2e/fixture': 'test/e2e',
}
const ENGINE = 'packages/engine'
const HARNESS = 'test/bench'
const PACKAGE_PATHS = [
  'packages/a',
  'packages/b',
  'packages/ab',
  'test/e2',
  'test/e2e',
  'test/e2e-core',
  '',
  ENGINE,
] as const
const SHAS = ['s1', 's2', 's3'] as const
const LANE_FILES = [
  '.github/workflows/bench.yml',
  'flake.lock',
  'flake.nix',
  '.github/actions/released-tarballs/action.yml',
]
const OTHER_FILES = ['README.md', 'packages/a/src/index.ts', '.github/workflows/ci.yml', 'docs/plans/x.md']

const shaArb = Arbitrary.schema(S.Literals(SHAS))
const optionShaArb = Arbitrary.schema(S.Literals(SHAS).pipe(S.Option))
const affectedArb = Arbitrary.array(Arbitrary.schema(S.Literals(PACKAGE_PATHS)), { maxLength: 4 })
const otherFilesArb = Arbitrary.array(Arbitrary.schema(S.Literals(OTHER_FILES)), { maxLength: 3 })
const laneFileArb = Arbitrary.schema(S.Literals(LANE_FILES))
const viaHarnessArb = Arbitrary.schema(S.Boolean)

type Selected = Result.Result<LegSelection, NoBenchBase>

const commandOf = (
  event: 'push' | 'workflow_dispatch',
  green: Option.Option<string>,
  parent: Option.Option<string>,
  changedFiles: ReadonlyArray<string>,
  affectedPaths: ReadonlyArray<string>,
): SelectLegsCommand =>
  SelectLegsCommand.make({
    event,
    head: 'head',
    greenAncestor: green,
    firstParent: parent,
    entries: [...ENTRIES],
    engineDirs: [ENGINE],
    changedFiles: [...changedFiles],
    affectedPaths: [...affectedPaths],
  })

const isFullCorpusFrom = (
  result: Selected,
  base: string,
  reason: FullCorpus['reason'],
): boolean =>
  Result.isSuccess(result) && S.is(FullCorpus)(result.success) && result.success.base === base &&
  result.success.reason === reason && result.success.legs.join() === ENTRIES.join()

const isNoBase = (result: Selected): boolean =>
  Result.isFailure(result) && S.is(NoBenchBase)(result.failure) && result.failure.head === 'head'

describe('selectLegs', () => {
  it.prop(
    '∀gpfa_Dispatch_≡TheFullCorpusAgainstTheFirstParentWhateverTheGreenAncestor',
    { of: [optionShaArb, optionShaArb, otherFilesArb, affectedArb], subject: selectLegs },
    (subject, [green, parent, files, affected]) => {
      const result = subject(commandOf('workflow_dispatch', green, parent, files, affected))
      return Option.match(parent, {
        onNone: () => isNoBase(result),
        onSome: (base) => isFullCorpusFrom(result, base, 'dispatch'),
      })
    },
  )

  it.prop(
    '∀pfa_PushWithNoGreenAncestor_≡TheFullCorpusAgainstTheFirstParent',
    { of: [optionShaArb, otherFilesArb, affectedArb], subject: selectLegs },
    (subject, [parent, files, affected]) => {
      const result = subject(commandOf('push', Option.none(), parent, files, affected))
      return Option.match(parent, {
        onNone: () => isNoBase(result),
        onSome: (base) => isFullCorpusFrom(result, base, 'no-green-ancestor'),
      })
    },
  )

  it.prop(
    '∀gplfah_PushChangingLaneInputsOrTheHarness_≡TheFullCorpusAgainstTheGreenAncestor',
    { of: [shaArb, optionShaArb, laneFileArb, otherFilesArb, affectedArb, viaHarnessArb], subject: selectLegs },
    (subject, [green, parent, laneFile, files, affected, viaHarness]) => {
      const changedFiles = viaHarness ? files : [...files, laneFile]
      const affectedPaths = viaHarness ? [...affected, HARNESS] : affected
      return isFullCorpusFrom(
        subject(commandOf('push', Option.some(green), parent, changedFiles, affectedPaths)),
        green,
        'lane-inputs-changed',
      )
    },
  )

  it.prop(
    '∀gpfa_PushFromTheGreenAncestor_≡RunsEachLegWhoseOwnerOrTheEngineIsAffectedAndSkipsTheRest',
    { of: [shaArb, optionShaArb, otherFilesArb, affectedArb], subject: selectLegs },
    (subject, [green, parent, files, affected]) => {
      const result = subject(commandOf('push', Option.some(green), parent, files, affected))
      const engine = affected.includes(ENGINE)
      const expectedLegs = ENTRIES.filter((entry) => engine || affected.some((path) => path === OWNER[entry]))
      const expectedSkipped = ENTRIES.filter((entry) => !expectedLegs.includes(entry))
      return Result.isSuccess(result) && S.is(AffectedLegs)(result.success) && result.success.base === green &&
        result.success.legs.join() === expectedLegs.join() &&
        result.success.skipped.join() === expectedSkipped.join()
    },
  )
})
