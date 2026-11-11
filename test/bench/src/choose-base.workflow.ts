import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  BaseChoice,
  FirstParentBase,
  type FirstParentReason,
  GreenBase,
  GreenRun,
  NoBenchBase,
} from './bench-plan.schema.js'

export class ChooseBaseCommand
  extends S.TaggedClass<ChooseBaseCommand, { readonly brand: unique symbol }>()('ChooseBaseCommand', {
    event: S.Literals(['push', 'workflow_dispatch']),
    head: S.NonEmptyString,
    greenRuns: S.Array(GreenRun),
    firstParent: S.Option(S.NonEmptyString),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const NEWEST_FIRST: Order.Order<GreenRun> = Order.mapInput(Order.flip(Order.Number), (run) => run.createdAtSeconds)

const fromFirstParent = (
  command: ChooseBaseCommand,
  reason: FirstParentReason,
): Result.Result<BaseChoice, NoBenchBase> =>
  Option.match(command.firstParent, {
    onNone: () => Result.fail(NoBenchBase.make({ head: command.head })),
    onSome: (sha) => Result.succeed(FirstParentBase.make({ sha, reason })),
  })

const newestGreenAncestor = (command: ChooseBaseCommand): Option.Option<GreenRun> =>
  Arr.head(
    Arr.sort(
      Arr.filter(command.greenRuns, (run) => Boolean.and(run.ancestor, run.sha !== command.head)),
      NEWEST_FIRST,
    ),
  )

const decide = (command: ChooseBaseCommand): Result.Result<BaseChoice, NoBenchBase> =>
  Boolean.match(command.event === 'workflow_dispatch', {
    onTrue: () => fromFirstParent(command, 'dispatch'),
    onFalse: () =>
      Option.match(newestGreenAncestor(command), {
        onNone: () => fromFirstParent(command, 'no-green-ancestor'),
        onSome: (run) => Result.succeed(GreenBase.make({ sha: run.sha })),
      }),
  })

export const chooseBase = Workflow.make({
  command: ChooseBaseCommand,
  decision: BaseChoice,
  error: NoBenchBase,
  decide,
})

const SHA = 's'

const acceptsCommand = (fields: { readonly event: string; readonly head: string }): boolean =>
  Result.isSuccess(
    S.decodeUnknownResult(ChooseBaseCommand)({
      _tag: 'ChooseBaseCommand',
      greenRuns: [],
      firstParent: Option.none(),
      ...fields,
    }),
  )

const commandVerdicts = (value: string): ReadonlyArray<boolean> => [
  acceptsCommand({ event: value, head: SHA }),
  acceptsCommand({ event: 'push', head: value }),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const events = ['push', 'workflow_dispatch']
  const expectedOf = (value: string): ReadonlyArray<boolean> => [events.includes(value), value.length > 0]

  it.prop(
    '∀s_ChooseBaseCommandRefusal_≡AKnownEventAndANonEmptyHead',
    { of: [S.String], subject: commandVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', ' ', SHA, 'pull_request', ...events], drawn),
        (value) =>
          Arr.every(Arr.zip(subject(value), expectedOf(value)), ([accepted, expected]) => accepted === expected),
      ),
  )
}
