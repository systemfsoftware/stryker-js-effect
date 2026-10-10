import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { ScriptOrigin } from './Location.schema.js'

import {
  type LocatedDirective,
  LocatedDirectiveSchema,
  MutatorNameSchema,
  type UnusedDirective,
} from './directives/directive.schema.js'
import {
  MutantKept,
  MutantSetFactsSchema,
  type MutantSetOutcome,
  mutantSetPolicy,
  MutantSetPolicyCommand,
  type MutantSetRuleId,
} from './mutant-set-policy.workflow.js'
import {
  type StaticStatus,
  subsumeMutants,
  SubsumeMutantsCommand,
  type SubsumptionDecision,
  SubsumptionReplacement,
  SubsumptionSite,
  Unaffected,
} from './subsume-mutants.workflow.js'

const WILDCARD = 'all'
const NEXT_LINE = 'next-line'

const RULE_SEPARATOR = ': '

const policyWorkflow = mutantSetPolicy
const policyCommand = MutantSetPolicyCommand
const keptOutcome = MutantKept
const subsumptionWorkflow = subsumeMutants
const subsumptionCommand = SubsumeMutantsCommand
const unaffectedOutcome = Unaffected

type IgnoreRule = 'directive' | 'excluded-mutator' | 'ignorer' | MutantSetRuleId

const ignoreReasonFor = (ruleId: IgnoreRule, detail: string): string => `${ruleId}${RULE_SEPARATOR}${detail}`

const IgnorerAnswerSchema = S.Struct({
  ignorerName: S.String,
  answer: S.Unknown,
})
export type IgnorerAnswer = typeof IgnorerAnswerSchema.Type

export const MutantCandidateSchema = S.Struct({
  id: Mutant.MutantId,
  mutatorName: MutatorNameSchema,
  replacementCode: S.String,
  location: S.optional(Mutant.Location),
  ignorerAnswer: S.optional(IgnorerAnswerSchema),
  aridReason: S.optional(Mutant.IgnoreStatusReasonText),
  mutantSet: MutantSetFactsSchema,
  subsumption: SubsumptionReplacement,
})
export type MutantCandidate = typeof MutantCandidateSchema.Type

const PlannedMutantSchema = S.Struct({
  id: Mutant.MutantId,
  mutatorName: MutatorNameSchema,
  replacementCode: S.String,
  location: Mutant.Location,
  ignoreReason: S.optional(S.String),
  subsumption: S.optional(Mutant.Subsumed),
})
export type PlannedMutant = typeof PlannedMutantSchema.Type

export class PlanMutantsCommand extends S.TaggedClass<PlanMutantsCommand>()('PlanMutantsCommand', {
  fileName: S.String,
  offset: ScriptOrigin,
  line: Mutant.Line,
  mutatorNames: S.Array(MutatorNameSchema),
  excludedMutations: S.Array(MutatorNameSchema),
  rule: S.Array(LocatedDirectiveSchema),
  directives: S.Array(LocatedDirectiveSchema),
  candidates: S.Array(MutantCandidateSchema),
  site: SubsumptionSite,
  mutantSetPolicy: Options.MutantSetPolicy,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MutantPlanTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/MutantPlan')
type MutantPlanTypeId = typeof MutantPlanTypeId

export class MutantsPlanned extends S.TaggedClass<MutantsPlanned>()('MutantsPlanned', {
  mutants: S.Array(PlannedMutantSchema),
  placeableIds: S.Array(Mutant.MutantId),
  warnings: S.Array(S.String),
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export class MutantsFullyIgnored extends S.TaggedClass<MutantsFullyIgnored>()('MutantsFullyIgnored', {
  mutants: S.Array(PlannedMutantSchema),
  warnings: S.Array(S.String),
}) {
  readonly [MutantPlanTypeId] = MutantPlanTypeId
}

export type MutantPlan = MutantsPlanned | MutantsFullyIgnored

export class MutantWithoutLocation extends S.TaggedError<MutantWithoutLocation>()('MutantWithoutLocation', {
  fileName: S.String,
  mutatorName: MutatorNameSchema,
}) {
  override get message(): string {
    return `Mutant without a source location: ${this.mutatorName} in ${this.fileName}`
  }
}

export class IgnorerAnsweredWithoutReason extends S.TaggedError<IgnorerAnsweredWithoutReason>()(
  'IgnorerAnsweredWithoutReason',
  {
    fileName: S.String,
    mutantId: Mutant.MutantId,
    ignorerName: S.String,
  },
) {
  override get message(): string {
    return `Ignorer "${this.ignorerName}" ignored mutant ${this.mutantId} in ${this.fileName} without a reason. Make its \`shouldIgnore\` return a non-empty reason string, or \`undefined\` to keep the mutant.`
  }
}

export type PlanFailure = MutantWithoutLocation | IgnorerAnsweredWithoutReason

const reachedLine = (located: LocatedDirective, line: number): boolean =>
  Match.value(located.directive.scope).pipe(
    Match.when(NEXT_LINE, () => located.governedLine === line),
    Match.when('block', () => true),
    Match.exhaustive,
  )

const namesMutator = (located: LocatedDirective, lowerMutatorName: string): boolean =>
  located.directive.mutatorNames.some((name) =>
    [name === WILDCARD, name.toLowerCase() === lowerMutatorName].some(Boolean)
  )

const lastReachingDirective = (
  rule: readonly LocatedDirective[],
  lowerMutatorName: string,
  line: number,
): Option.Option<LocatedDirective> =>
  Option.fromNullishOr(
    rule.findLast((located) => [reachedLine(located, line), namesMutator(located, lowerMutatorName)].every(Boolean)),
  )

const directiveReason = (
  rule: readonly LocatedDirective[],
  mutatorName: string,
  line: number,
): Option.Option<string> =>
  Option.flatMap(
    lastReachingDirective(rule, mutatorName.toLowerCase(), line),
    (located) =>
      Match.value(located.directive.action).pipe(
        Match.when('disable', () => Option.some(ignoreReasonFor('directive', located.directive.reason))),
        Match.when('restore', () => Option.none<string>()),
        Match.exhaustive,
      ),
  )

const exclusionReason = (
  excludedMutations: readonly string[],
  mutatorName: string,
): Option.Option<string> =>
  Match.value(excludedMutations.includes(mutatorName)).pipe(
    Match.when(true, () =>
      Option.some(
        ignoreReasonFor('excluded-mutator', `Ignored because of excluded mutation "${mutatorName}"`),
      )),
    Match.when(false, () => Option.none<string>()),
    Match.exhaustive,
  )

const ignorerReasonText = (answered: IgnorerAnswer): Option.Option<string> =>
  Option.filter(S.decodeUnknownOption(S.String)(answered.answer), (reason) => reason.trim().length > 0)

const ignorerRefusalOf = (
  command: PlanMutantsCommand,
  candidate: MutantCandidate,
): Option.Option<IgnorerAnsweredWithoutReason> =>
  Option.flatMap(
    Option.fromNullishOr(candidate.ignorerAnswer),
    (answered) =>
      Option.match(ignorerReasonText(answered), {
        onNone: () =>
          Option.some(
            IgnorerAnsweredWithoutReason.make({
              fileName: command.fileName,
              mutantId: candidate.id,
              ignorerName: answered.ignorerName,
            }),
          ),
        onSome: () => Option.none<IgnorerAnsweredWithoutReason>(),
      }),
  )

const ignorerReason = (candidate: MutantCandidate): Option.Option<string> =>
  Option.map(
    Option.flatMap(Option.fromNullishOr(candidate.ignorerAnswer), ignorerReasonText),
    (reason) => ignoreReasonFor('ignorer', reason),
  )

const ignoreReasonOf = (
  command: PlanMutantsCommand,
  candidate: MutantCandidate,
  policyReason: string | undefined,
): string | undefined =>
  Option.getOrUndefined(
    Option.orElse(
      Option.orElse(
        Option.orElse(
          Option.orElse(
            directiveReason(command.rule, candidate.mutatorName, command.line),
            () => exclusionReason(command.excludedMutations, candidate.mutatorName),
          ),
          () => ignorerReason(candidate),
        ),
        () => Option.fromNullishOr(policyReason),
      ),
      () => Option.fromNullishOr(candidate.aridReason),
    ),
  )

const policyOutcomes = (command: PlanMutantsCommand): readonly MutantSetOutcome[] =>
  Result.match(
    policyWorkflow(
      policyCommand.make({
        policy: command.mutantSetPolicy,
        candidates: command.candidates.map((candidate) => candidate.mutantSet),
      }),
    ),
    {
      onFailure: () => command.candidates.map(() => keptOutcome.make({})),
      onSuccess: (outcomes) => outcomes,
    },
  )

const policyReasonOf = (outcome: MutantSetOutcome): string | undefined =>
  Match.value(outcome).pipe(
    Match.withReturnType<string | undefined>(),
    Match.tag('MutantSuppressed', (suppressed) => ignoreReasonFor(suppressed.ruleId, suppressed.detail)),
    Match.tag('MutantKept', () => undefined),
    Match.exhaustive,
  )

const policyReasonsAt = (command: PlanMutantsCommand): readonly (string | undefined)[] =>
  policyOutcomes(command).map(policyReasonOf)

const staticReasonsAt = (command: PlanMutantsCommand): readonly (string | undefined)[] => {
  const policyReasons = policyReasonsAt(command)
  return command.candidates.map((candidate, index) => ignoreReasonOf(command, candidate, policyReasons[index]))
}

const staticStatusOf = (reason: string | undefined): StaticStatus =>
  Option.match(Option.fromNullishOr(reason), {
    onNone: (): StaticStatus => 'StaticallyKept',
    onSome: (): StaticStatus => 'StaticallyIgnored',
  })

const subsumptionsAt = (
  command: PlanMutantsCommand,
  staticReasons: readonly (string | undefined)[],
): readonly SubsumptionDecision[] =>
  Result.match(
    subsumptionWorkflow(
      subsumptionCommand.make({
        policy: command.mutantSetPolicy,
        site: command.site,
        candidates: command.candidates.map((candidate, index) => ({
          id: candidate.id,
          replacement: candidate.subsumption,
          status: staticStatusOf(staticReasons[index]),
        })),
      }),
    ),
    {
      onFailure: () => command.candidates.map(() => unaffectedOutcome.make({})),
      onSuccess: (decisions) => decisions,
    },
  )

const subsumedOf = (decision: SubsumptionDecision): Option.Option<Mutant.Subsumed> =>
  Match.value(decision).pipe(
    Match.tag('Subsumed', (subsumed) =>
      Option.some<Mutant.Subsumed>({ _tag: 'Subsumed', rule: subsumed.rule, dominators: subsumed.dominators })),
    Match.tag('Unaffected', () =>
      Option.none<Mutant.Subsumed>()),
    Match.exhaustive,
  )

interface CandidateReasons {
  readonly ignoreReason: string | undefined
  readonly subsumption: Option.Option<Mutant.Subsumed>
}

const candidateReasonsAt = (command: PlanMutantsCommand): readonly CandidateReasons[] => {
  const staticReasons = staticReasonsAt(command)
  return Arr.zip(staticReasons, subsumptionsAt(command, staticReasons)).map(([ignoreReason, decision]) => ({
    ignoreReason,
    subsumption: subsumedOf(decision),
  }))
}

const unusedDirectives = (
  directives: readonly LocatedDirective[],
  mutatorNames: readonly string[],
): readonly UnusedDirective[] =>
  directives.flatMap((located) =>
    located.directive.mutatorNames
      .filter((mutatorName) => mutatorName !== WILDCARD)
      .filter((mutatorName) => !mutatorNames.includes(mutatorName.toLowerCase()))
      .map((mutatorName): UnusedDirective => ({
        directive: located.directive,
        at: located.at,
        mutatorName,
      }))
  )

const unusedDirectiveWarning = (unused: UnusedDirective, fileName: string): string => {
  const label = Match.value(unused.directive.scope).pipe(
    Match.when(NEXT_LINE, () => `${unused.directive.action} ${NEXT_LINE}`),
    Match.when('block', () => unused.directive.action),
    Match.exhaustive,
  )
  return `Unused 'Stryker ${label}' directive. Mutator with name '${unused.mutatorName}' not found. ` +
    `Directive found at: ${fileName}:${unused.at.line}:${unused.at.column}.`
}

const warningsOf = (command: PlanMutantsCommand): readonly string[] =>
  unusedDirectives(command.directives, command.mutatorNames)
    .map((unused) => unusedDirectiveWarning(unused, command.fileName))

/**
 * The node span (`source`) is a 1-based position inside the embedded script;
 * the region origin (`offset`) is where that script begins in its host file.
 * The region's first line carries its column shift, later lines start at
 * column 1, so the shift adds `offset.line - 1` lines and — only when the node
 * sits on the region's first line — `offset.columnShift`.
 */
const columnOffsetOf = (source: Mutant.Position, offset: ScriptOrigin): number =>
  Match.value(source.line === 1).pipe(
    Match.when(true, () => offset.columnShift),
    Match.when(false, () => 0),
    Match.exhaustive,
  )

const shiftedPosition = (source: Mutant.Position, offset: ScriptOrigin): Mutant.Position => ({
  column: source.column + columnOffsetOf(source, offset),
  line: source.line + offset.line - 1,
})

const shiftedLocation = (location: Mutant.Location, offset: ScriptOrigin): Mutant.Location => ({
  start: shiftedPosition(location.start, offset),
  end: shiftedPosition(location.end, offset),
})

const plannedMutant = (
  command: PlanMutantsCommand,
  candidate: MutantCandidate,
  reasons: CandidateReasons,
): Result.Result<PlannedMutant, PlanFailure> =>
  Option.match(ignorerRefusalOf(command, candidate), {
    onSome: (refusal) => Result.fail(refusal),
    onNone: () =>
      Option.match(Option.fromNullishOr(candidate.location), {
        onNone: () =>
          Result.fail(MutantWithoutLocation.make({ fileName: command.fileName, mutatorName: candidate.mutatorName })),
        onSome: (location) =>
          Result.succeed({
            id: candidate.id,
            mutatorName: candidate.mutatorName,
            replacementCode: candidate.replacementCode,
            location: shiftedLocation(location, command.offset),
            ignoreReason: reasons.ignoreReason,
            ...Option.match(reasons.subsumption, { onNone: () => ({}), onSome: (subsumption) => ({ subsumption }) }),
          }),
      }),
  })

const plannedMutants = (
  command: PlanMutantsCommand,
  reasons: readonly CandidateReasons[],
): Result.Result<readonly PlannedMutant[], PlanFailure> =>
  Arr.zip(command.candidates, reasons).reduce<Result.Result<readonly PlannedMutant[], PlanFailure>>(
    (accumulated, [candidate, reason]) =>
      Result.flatMap(
        accumulated,
        (mutants) =>
          Result.map(
            plannedMutant(command, candidate, reason),
            (mutant) => [...mutants, mutant],
          ),
      ),
    Result.succeed([]),
  )

const withoutReason = (mutant: PlannedMutant): boolean => mutant.ignoreReason === undefined

const planOf = (command: PlanMutantsCommand, mutants: readonly PlannedMutant[]): MutantPlan =>
  Match.value(mutants.some(withoutReason)).pipe(
    Match.when(true, () =>
      MutantsPlanned.make({
        mutants: [...mutants],
        placeableIds: mutants.filter(withoutReason).map((mutant) => mutant.id),
        warnings: warningsOf(command),
      })),
    Match.when(false, () =>
      MutantsFullyIgnored.make({
        mutants: [...mutants],
        warnings: warningsOf(command),
      })),
    Match.exhaustive,
  )

export const planMutants = Workflow.make({
  command: PlanMutantsCommand,
  decision: S.Union([MutantsPlanned, MutantsFullyIgnored]),
  error: S.Union([MutantWithoutLocation, IgnorerAnsweredWithoutReason]),
  decide: (command: PlanMutantsCommand): Result.Result<MutantPlan, PlanFailure> =>
    Result.gen(function*() {
      const reasons = candidateReasonsAt(command)
      const mutants = yield* plannedMutants(command, reasons)
      return planOf(command, mutants)
    }),
})
