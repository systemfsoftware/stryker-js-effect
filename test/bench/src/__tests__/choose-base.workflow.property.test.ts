import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type BaseChoice, FirstParentBase, GreenBase, GreenRun, NoBenchBase } from '../bench-plan.schema.js'
import { chooseBase, ChooseBaseCommand } from '../choose-base.workflow.js'

const PUSHED = 'pushed'

const runsArb = Arbitrary.array(Arbitrary.schema(GreenRun), { maxLength: 6 })
const parentArb = Arbitrary.schema(S.NonEmptyString.pipe(S.Option))
const headIsGreenArb = Arbitrary.schema(S.Boolean)

type Chosen = Result.Result<BaseChoice, NoBenchBase>

const headOf = (runs: ReadonlyArray<GreenRun>, headIsGreen: boolean): string =>
  headIsGreen && runs.length > 0 ? runs[0].sha : PUSHED

const commandOf = (
  event: 'push' | 'workflow_dispatch',
  head: string,
  greenRuns: ReadonlyArray<GreenRun>,
  firstParent: Option.Option<string>,
): ChooseBaseCommand => ChooseBaseCommand.make({ event, head, greenRuns: [...greenRuns], firstParent })

const isFirstParentOr = (
  result: Chosen,
  head: string,
  parent: Option.Option<string>,
  reason: FirstParentBase['reason'],
): boolean =>
  Option.match(parent, {
    onNone: () => Result.isFailure(result) && S.is(NoBenchBase)(result.failure) && result.failure.head === head,
    onSome: (sha) =>
      Result.isSuccess(result) && S.is(FirstParentBase)(result.success) && result.success.sha === sha &&
      result.success.reason === reason,
  })

describe('chooseBase', () => {
  it.prop(
    '∀rph_Dispatch_≡TheFirstParentWhateverTheGreenRuns',
    { of: [runsArb, parentArb, headIsGreenArb], subject: chooseBase },
    (subject, [runs, parent, headIsGreen]) => {
      const head = headOf(runs, headIsGreen)
      return isFirstParentOr(subject(commandOf('workflow_dispatch', head, runs, parent)), head, parent, 'dispatch')
    },
  )

  it.prop(
    '∀rph_Push_≡TheNewestGreenAncestorThatIsNotThePushedCommitElseTheFirstParent',
    { of: [runsArb, parentArb, headIsGreenArb], subject: chooseBase },
    (subject, [runs, parent, headIsGreen]) => {
      const head = headOf(runs, headIsGreen)
      const result = subject(commandOf('push', head, runs, parent))
      const qualifying = runs.filter((run) => run.ancestor && run.sha !== head)
      const newest = Math.max(...qualifying.map((run) => run.createdAtSeconds))
      return qualifying.length === 0
        ? isFirstParentOr(result, head, parent, 'no-green-ancestor')
        : Result.isSuccess(result) && S.is(GreenBase)(result.success) &&
          qualifying.some((run) => run.sha === result.success.sha && run.createdAtSeconds === newest)
    },
  )
})
