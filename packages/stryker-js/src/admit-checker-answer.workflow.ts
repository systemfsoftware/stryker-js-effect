import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class CheckerAnsweredUnrequested extends S.TaggedError<CheckerAnsweredUnrequested>()(
  'CheckerAnsweredUnrequested',
  {
    checkerName: S.String,
    phase: S.Literals(['check', 'group']),
    unrequestedIds: S.Array(S.String),
    requestedIds: S.Array(S.String),
  },
) {
  override get message(): string {
    return `Checker "${this.checkerName}" answered about mutants it was not asked about (${this.phase} phase): ${
      this.unrequestedIds.join(', ')
    }`
  }
}

export class CheckerSkippedRequested extends S.TaggedError<CheckerSkippedRequested>()(
  'CheckerSkippedRequested',
  {
    checkerName: S.String,
    phase: S.Literals(['check', 'group']),
    missingIds: S.Array(S.String),
  },
) {
  override get message(): string {
    return `Checker "${this.checkerName}" skipped requested mutants (${this.phase} phase): ${
      this.missingIds.join(', ')
    }`
  }
}

export class CheckerIgnoredWithoutRule extends S.TaggedError<CheckerIgnoredWithoutRule>()(
  'CheckerIgnoredWithoutRule',
  {
    checkerName: S.String,
    mutantId: S.String,
    answered: S.String,
  },
) {
  override get message(): string {
    return `Checker "${this.checkerName}" ignored mutant ${this.mutantId} without a reason naming a rule from the ignore-rule vocabulary (\`<rule-id>: <detail>\`): it answered ${this.answered}. Fix the checker to answer \`{ status: 'ignored', reason: 'checker: <why>' }\`, or answer \`passed\` to keep the mutant.`
  }
}

export type CheckerContractBroken = CheckerAnsweredUnrequested | CheckerSkippedRequested | CheckerIgnoredWithoutRule

export class CheckerCommand extends S.TaggedClass<CheckerCommand>()('CheckerCommand', {
  checkerName: S.String,
  requestedIds: S.Array(Mutant.MutantId),
  phase: S.Literals(['check', 'group']),
  idGroups: S.String.pipe(S.Array, S.Array, S.optional),
  answers: S.optional(S.Record(S.String, Checker.CheckAnswerSchema)),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    checkerName: 'stryker.checker.name',
  } as const
}

const CheckerDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CheckerDecision')
type CheckerDecisionTypeId = typeof CheckerDecisionTypeId

export class CheckGroupDecision extends S.TaggedClass<CheckGroupDecision>()('CheckGroupDecision', {
  groups: S.String.pipe(S.Array, S.Array),
}) {
  readonly [CheckerDecisionTypeId] = CheckerDecisionTypeId
}

const AdmittedCheckPair = S.Struct({ id: S.String, result: Checker.CheckResultSchema })

export class CheckResultDecision extends S.TaggedClass<CheckResultDecision>()('CheckResultDecision', {
  pairs: S.Array(AdmittedCheckPair),
}) {
  readonly [CheckerDecisionTypeId] = CheckerDecisionTypeId
}

export type CheckerDecision = CheckGroupDecision | CheckResultDecision

const idRecord = (ids: readonly string[]): Record<string, true> =>
  Object.fromEntries(ids.map((id): readonly [string, true] => [id, true]))

const acknowledgedIds = (
  submitted: readonly string[],
  requested: Readonly<Record<string, true>>,
): Record<string, true> => idRecord(submitted.filter((id) => requested[id] === true))

const answeredUnrequested = (
  command: CheckerCommand,
  submitted: readonly string[],
  requested: Readonly<Record<string, true>>,
) =>
  Option.liftPredicate(Arr.isReadonlyArrayNonEmpty)(submitted.filter((id) => !(id in requested))).pipe(
    Option.map(
      (unrequestedIds) =>
        CheckerAnsweredUnrequested.make({
          checkerName: command.checkerName,
          phase: command.phase,
          unrequestedIds,
          requestedIds: [...command.requestedIds],
        }),
    ),
  )

const skippedRequested = (command: CheckerCommand, acknowledged: Readonly<Record<string, true>>) =>
  Option.liftPredicate(Arr.isReadonlyArrayNonEmpty)(command.requestedIds.filter((id) => !(id in acknowledged))).pipe(
    Option.map(
      (missingIds) =>
        CheckerSkippedRequested.make({
          checkerName: command.checkerName,
          phase: command.phase,
          missingIds,
        }),
    ),
  )

const contractBreach = (
  command: CheckerCommand,
  requested: Readonly<Record<string, true>>,
  submitted: readonly string[],
) =>
  Option.firstSomeOf([
    answeredUnrequested(command, submitted, requested),
    skippedRequested(command, acknowledgedIds(submitted, requested)),
  ])

const admit = <D>(
  command: CheckerCommand,
  requested: Readonly<Record<string, true>>,
  submitted: readonly string[],
  decision: () => Result.Result<D, CheckerContractBroken>,
): Result.Result<D, CheckerContractBroken> =>
  Option.match(contractBreach(command, requested, submitted), {
    onNone: decision,
    onSome: (breach) => Result.fail<CheckerContractBroken>(breach),
  })

const idGroupsOf = (command: CheckerCommand) =>
  Option.getOrElse((): readonly (readonly string[])[] => [])(Option.fromUndefinedOr(command.idGroups))

const answersOf = (command: CheckerCommand) =>
  Option.getOrElse((): Record<string, Checker.CheckAnswer> => ({}))(Option.fromUndefinedOr(command.answers))

const evaluateGroup = (command: CheckerCommand) => {
  const idGroups = idGroupsOf(command)
  return admit(
    command,
    idRecord(command.requestedIds),
    idGroups.flat(),
    () => Result.succeed(CheckGroupDecision.make({ groups: idGroups.map((group) => [...group]) })),
  )
}

const decodeAdmittedPair = S.decodeUnknownOption(AdmittedCheckPair)

const admittedPairOf = (checkerName: string) => (id: string, answer: Checker.CheckAnswer) =>
  Option.match(decodeAdmittedPair({ id, result: answer }), {
    onNone: () =>
      Result.fail(CheckerIgnoredWithoutRule.make({ checkerName, mutantId: id, answered: JSON.stringify(answer) })),
    onSome: (pair) => Result.succeed(pair),
  })

const evaluateCheckResult = (command: CheckerCommand) => {
  const requested = idRecord(command.requestedIds)
  const entries = Object.entries(answersOf(command))
  const admittedPair = admittedPairOf(command.checkerName)
  return admit(
    command,
    requested,
    entries.map(([id]) => id),
    () =>
      Result.map(
        Result.all(entries.filter(([id]) => requested[id] === true).map(([id, answer]) => admittedPair(id, answer))),
        (pairs) => CheckResultDecision.make({ pairs }),
      ),
  )
}

export const admitCheckerAnswer = Workflow.make({
  command: CheckerCommand,
  decision: S.Union([CheckGroupDecision, CheckResultDecision]),
  error: S.Union([CheckerAnsweredUnrequested, CheckerSkippedRequested, CheckerIgnoredWithoutRule]),
  decide: (command): Result.Result<CheckerDecision, CheckerContractBroken> =>
    Match.value(command.phase).pipe(
      Match.when('group', () => evaluateGroup(command)),
      Match.when('check', () => evaluateCheckResult(command)),
      Match.exhaustive,
    ),
})
