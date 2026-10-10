/// <reference types="vitest/importMeta" />
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export class UndescribableMutant extends S.TaggedError<UndescribableMutant>()('UndescribableMutant', {
  id: Mutant.MutantId,
  fileName: Mutant.CanonicalFileName,
  reason: S.String,
}) {
  override get message(): string {
    return `Mutant ${this.id} in ${this.fileName} cannot be described to a checker: ${this.reason}`
  }
}

const CheckerMutant = S.toType(Checker.CheckerMutantWire)

export const CheckerMutantFromMutant = S.decodeTo<typeof CheckerMutant, typeof Mutant.Mutant>(
  CheckerMutant,
  SchemaTransformation.transform({
    decode: (mutant) => ({
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
    }),
    encode: (wire) =>
      Mutant.Mutant.make({
        id: wire.id,
        fileName: wire.fileName,
        mutatorName: wire.mutatorName,
        replacement: wire.replacement,
        location: wire.location,
      }),
  }),
)(Mutant.Mutant)

const DescriptionCandidate = S.Struct({
  id: Mutant.MutantId,
  fileName: Mutant.CanonicalFileName,
  mutant: S.Unknown,
})

/**
 * Each candidate's `mutant` stays undecoded because whether it decodes is the decision;
 * `id` and `fileName` name it when it is refused.
 */
export class DescribeCheckerMutantsCommand
  extends S.TaggedClass<DescribeCheckerMutantsCommand>()('DescribeCheckerMutantsCommand', {
    candidates: S.Array(DescriptionCandidate),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MutantDescriptionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantDescription')
type MutantDescriptionTypeId = typeof MutantDescriptionTypeId

export class MutantDescribed extends S.TaggedClass<MutantDescribed>()('MutantDescribed', {
  wire: Checker.CheckerMutantWire,
}) {
  readonly [MutantDescriptionTypeId] = MutantDescriptionTypeId
}

export class MutantUndescribable extends S.TaggedClass<MutantUndescribable>()('MutantUndescribable', {
  undescribable: UndescribableMutant,
}) {
  readonly [MutantDescriptionTypeId] = MutantDescriptionTypeId
}

export const MutantDescription = S.Union([MutantDescribed, MutantUndescribable])
export type MutantDescription = typeof MutantDescription.Type

export interface PartitionedMutants {
  readonly wire: readonly Checker.CheckerMutantWire[]
  readonly undescribable: readonly UndescribableMutant[]
}

const wireOrRefused = Match.typeTags<MutantDescription>()({
  MutantDescribed: ({ wire }) => Result.succeed(wire),
  MutantUndescribable: ({ undescribable }) => Result.fail(undescribable),
})

export const partitionedMutantsOf = (descriptions: readonly MutantDescription[]): PartitionedMutants => {
  const [wire, undescribable] = Arr.partition(descriptions, wireOrRefused)
  return { wire, undescribable }
}

export const compileErrorAnswersOf = (
  undescribable: readonly UndescribableMutant[],
): Readonly<Record<string, Checker.CheckResult>> =>
  Object.fromEntries(
    undescribable.map((mutant): readonly [string, Checker.CheckResult] => [
      mutant.id,
      { status: 'compileError', reason: mutant.reason },
    ]),
  )

export const singletonGroupsOf = (undescribable: readonly UndescribableMutant[]): readonly (readonly string[])[] =>
  undescribable.map((mutant) => [mutant.id])

export const undescribableIdsOf = (undescribable: readonly UndescribableMutant[]): ReadonlySet<string> =>
  new Set(undescribable.map((mutant) => mutant.id))

export interface CheckerPlans {
  readonly checkerName: string
  readonly plans: readonly Mutant.RunPlan[]
}

export type GroupedPlansResult = readonly (readonly Mutant.RunPlan[])[]

export type CheckedPlansResult = readonly (readonly [Mutant.RunPlan, Checker.CheckResult])[]

export const describeCommandOf = (request: CheckerPlans): DescribeCheckerMutantsCommand =>
  DescribeCheckerMutantsCommand.make({
    candidates: request.plans.map((plan) => ({
      id: plan.mutant.id,
      fileName: plan.mutant.fileName,
      mutant: plan.mutant,
    })),
  })

export const plansByIdOf = (request: CheckerPlans): ReadonlyMap<string, Mutant.RunPlan> =>
  new Map<string, Mutant.RunPlan>(request.plans.map((plan) => [plan.mutant.id, plan]))

export interface RefusedCheckerCommand {
  readonly issue: string
  readonly input: CheckerPlans
}

export const commandFailed = (refused: RefusedCheckerCommand): Checker.CheckerFailed =>
  Checker.CheckerFailed.make({
    cause: refused.issue,
    checkerName: refused.input.checkerName,
    mutantIds: refused.input.plans.map((plan) => plan.mutant.id),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const DrawnRunPlans = S.Array(S.Tuple([Mutant.Mutant, Mutant.MutantRunOptionsSchema, S.Finite]))

  const runPlansOf = (
    drawn: typeof DrawnRunPlans.Type,
  ): readonly Mutant.RunPlan[] =>
    drawn.map(([mutant, runOptions, netTime]): Mutant.RunPlan => ({ plan: 'Run', mutant, runOptions, netTime }))

  const holds = (conditions: readonly boolean[]): boolean => conditions.every((condition) => condition)

  it.prop(
    '∀d_Partition_≡InterleavesBackToTheDescriptions',
    { of: [S.Array(MutantDescription)], subject: partitionedMutantsOf },
    (subject, [descriptions]) => {
      const { wire, undescribable } = subject(descriptions)
      const rebuilt = Arr.reduce(
        descriptions,
        { wireAt: 0, undescribableAt: 0, agrees: wire.length + undescribable.length === descriptions.length },
        (state, description) =>
          Match.valueTags(description, {
            MutantDescribed: (described) => ({
              ...state,
              wireAt: state.wireAt + 1,
              agrees: state.agrees && wire[state.wireAt] === described.wire,
            }),
            MutantUndescribable: (refused) => ({
              ...state,
              undescribableAt: state.undescribableAt + 1,
              agrees: state.agrees && undescribable[state.undescribableAt] === refused.undescribable,
            }),
          }),
      )
      return rebuilt.agrees
    },
  )

  it.prop(
    '∀u_CompileErrorAnswers_≡EachIdAnsweredWithItsLastReason',
    { of: [S.Array(UndescribableMutant)], subject: compileErrorAnswersOf },
    (subject, [undescribable]) => {
      const answers = subject(undescribable)
      const lastReasonById = new Map(undescribable.map((mutant) => [mutant.id, mutant.reason]))
      return Object.keys(answers).length === lastReasonById.size &&
        Arr.every(
          [...lastReasonById],
          ([id, reason]) => JSON.stringify(answers[id]) === JSON.stringify({ status: 'compileError', reason }),
        )
    },
  )

  it.prop(
    '∀u_SingletonGroups_≡OneGroupPerMutantInOrder',
    { of: [S.Array(UndescribableMutant)], subject: singletonGroupsOf },
    (subject, [undescribable]) => {
      const groups = subject(undescribable)
      return groups.length === undescribable.length &&
        Arr.every(Arr.zip(groups, undescribable), ([group, mutant]) => group.length === 1 && group[0] === mutant.id)
    },
  )

  it.prop(
    '∀u_UndescribableIds_≡ExactlyTheRefusedIds',
    { of: [S.Array(UndescribableMutant)], subject: undescribableIdsOf },
    (subject, [undescribable]) => {
      const ids = subject(undescribable)
      return ids.size === new Set(undescribable.map((mutant) => mutant.id)).size &&
        Arr.every(undescribable, (mutant) => ids.has(mutant.id))
    },
  )

  it.prop(
    '∀p_DescribeCommand_≡OneCandidatePerPlanInOrder',
    { of: [S.String, DrawnRunPlans], subject: describeCommandOf },
    (subject, [checkerName, drawn]) => {
      const plans = runPlansOf(drawn)
      const { candidates } = subject({ checkerName, plans })
      return candidates.length === plans.length &&
        Arr.every(Arr.zip(candidates, plans), ([candidate, plan]) =>
          holds([
            candidate.id === plan.mutant.id,
            candidate.fileName === plan.mutant.fileName,
            candidate.mutant === plan.mutant,
          ]))
    },
  )

  it.prop(
    '∀p_PlansById_≡EachIdKeysItsLastPlan',
    { of: [S.String, DrawnRunPlans], subject: plansByIdOf },
    (subject, [checkerName, drawn]) => {
      const plans = runPlansOf(drawn)
      const byId = subject({ checkerName, plans })
      const lastPlanById = Arr.reduce(
        plans,
        new Map<string, Mutant.RunPlan>(),
        (latest, plan) => latest.set(plan.mutant.id, plan),
      )
      return byId.size === lastPlanById.size &&
        Arr.every([...lastPlanById], ([id, plan]) => byId.get(id) === plan)
    },
  )

  it.prop(
    '∀p_CommandFailed_≡CarriesIssueCheckerAndPlanIdsInOrder',
    { of: [S.String, S.String, DrawnRunPlans], subject: commandFailed },
    (subject, [issue, checkerName, drawn]) => {
      const plans = runPlansOf(drawn)
      const failed = subject({ issue, input: { checkerName, plans } })
      return holds([
        failed.cause === issue,
        failed.checkerName === checkerName,
        failed.mutantIds.length === plans.length,
        Arr.every(Arr.zip(failed.mutantIds, plans), ([id, plan]) => id === plan.mutant.id),
      ])
    },
  )
}
