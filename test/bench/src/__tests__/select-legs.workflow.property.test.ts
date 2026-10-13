import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  AffectedLegs,
  type BaseChoice,
  FirstParentBase,
  FullCorpus,
  GreenBase,
  type LegSelection,
} from '../bench-plan.schema.js'
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
const firstParentBaseArb = Arbitrary.schema(FirstParentBase)
const affectedArb = Arbitrary.array(Arbitrary.schema(S.Literals(PACKAGE_PATHS)), { maxLength: 4 })
const otherFilesArb = Arbitrary.array(Arbitrary.schema(S.Literals(OTHER_FILES)), { maxLength: 3 })
const laneFileArb = Arbitrary.schema(S.Literals(LANE_FILES))
const viaHarnessArb = Arbitrary.schema(S.Boolean)

type Selected = Result.Result<LegSelection, never>

const commandOf = (
  base: BaseChoice,
  changedFiles: ReadonlyArray<string>,
  affectedPaths: ReadonlyArray<string>,
): SelectLegsCommand =>
  SelectLegsCommand.make({
    base,
    entries: [...ENTRIES],
    engineDirs: [ENGINE],
    changedFiles: [...changedFiles],
    affectedPaths: [...affectedPaths],
  })

const isFullCorpusFrom = (result: Selected, base: string, reason: FullCorpus['reason']): boolean =>
  Result.isSuccess(result) && S.is(FullCorpus)(result.success) && result.success.base === base &&
  result.success.reason === reason && result.success.legs.join() === ENTRIES.join()

describe('selectLegs', () => {
  it.prop(
    '∀bfa_FirstParentBase_≡TheFullCorpusAgainstThatParentForItsReasonWhateverTheDiff',
    { of: [firstParentBaseArb, otherFilesArb, affectedArb], subject: selectLegs },
    (subject, [parent, files, affected]) =>
      isFullCorpusFrom(subject(commandOf(parent, files, affected)), parent.sha, parent.reason),
  )

  it.prop(
    '∀glfah_GreenBaseChangingLaneInputsOrTheHarness_≡TheFullCorpusAgainstTheGreenBase',
    { of: [shaArb, laneFileArb, otherFilesArb, affectedArb, viaHarnessArb], subject: selectLegs },
    (subject, [green, laneFile, files, affected, viaHarness]) => {
      const changedFiles = viaHarness ? files : [...files, laneFile]
      const affectedPaths = viaHarness ? [...affected, HARNESS] : affected
      return isFullCorpusFrom(
        subject(commandOf(GreenBase.make({ sha: green }), changedFiles, affectedPaths)),
        green,
        'lane-inputs-changed',
      )
    },
  )

  it.prop(
    '∀gfa_GreenBase_≡RunsEachLegWhoseOwnerOrTheEngineIsAffectedAndSkipsTheRest',
    { of: [shaArb, otherFilesArb, affectedArb], subject: selectLegs },
    (subject, [green, files, affected]) => {
      const result = subject(commandOf(GreenBase.make({ sha: green }), files, affected))
      const engine = affected.includes(ENGINE)
      const expectedLegs = ENTRIES.filter((entry) => engine || affected.some((path) => path === OWNER[entry]))
      const expectedSkipped = ENTRIES.filter((entry) => !expectedLegs.includes(entry))
      return Result.isSuccess(result) && S.is(AffectedLegs)(result.success) && result.success.base === green &&
        result.success.legs.join() === expectedLegs.join() &&
        result.success.skipped.join() === expectedSkipped.join()
    },
  )
})
