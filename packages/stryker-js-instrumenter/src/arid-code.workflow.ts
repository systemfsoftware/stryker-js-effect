import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ARID_RULE_IDS = [
  'arid-logging',
  'arid-telemetry',
  'arid-time',
  'arid-config-default',
  'arid-memoization',
] as const satisfies readonly Mutant.IgnoreRuleIdValue[]

export const AridRuleId = S.Literals(ARID_RULE_IDS)
export type AridRuleId = typeof AridRuleId.Type

export const AridCalleeSchema = S.Struct({
  object: S.String,
  member: S.String,
})
export type AridCallee = typeof AridCalleeSchema.Type

export const AridFrameSchema = S.Struct({
  callee: S.Option(AridCalleeSchema),
  childIsArgument: S.Boolean,
})
export type AridFrame = typeof AridFrameSchema.Type

interface AridRule {
  readonly ruleId: AridRuleId
  readonly matches: (callee: AridCallee) => boolean
}

const NAMED_LOGGERS: ReadonlyArray<string> = ['Logger', 'console']

const readsNamespace = (callee: AridCallee, object: string): boolean => callee.object === object

const readsName = (callee: AridCallee, name: string): boolean => callee.member === name

const readsMember = (callee: AridCallee, object: string, member: string): boolean =>
  [readsNamespace(callee, object), readsName(callee, member)].every(Boolean)

const readsMemberPrefixed = (callee: AridCallee, object: string, prefix: string): boolean =>
  [readsNamespace(callee, object), callee.member.startsWith(prefix)].every(Boolean)

const ARID_RULES_IN_PRECEDENCE_ORDER: ReadonlyArray<AridRule> = [
  { ruleId: 'arid-logging', matches: (callee) => readsMemberPrefixed(callee, 'Effect', 'log') },
  { ruleId: 'arid-logging', matches: (callee) => NAMED_LOGGERS.includes(callee.object) },
  { ruleId: 'arid-telemetry', matches: (callee) => readsMember(callee, 'Effect', 'withSpan') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsMemberPrefixed(callee, 'Effect', 'annotate') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsMember(callee, 'Effect', 'withLogSpan') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsNamespace(callee, 'Metric') },
  { ruleId: 'arid-time', matches: (callee) => readsMember(callee, 'Effect', 'sleep') },
  { ruleId: 'arid-time', matches: (callee) => readsNamespace(callee, 'Schedule') },
  { ruleId: 'arid-time', matches: (callee) => readsNamespace(callee, 'Duration') },
  { ruleId: 'arid-time', matches: (callee) => readsMember(callee, 'Date', 'now') },
  { ruleId: 'arid-config-default', matches: (callee) => readsMember(callee, 'Config', 'withDefault') },
  { ruleId: 'arid-memoization', matches: (callee) => readsMember(callee, 'Effect', 'cached') },
  { ruleId: 'arid-memoization', matches: (callee) => readsMember(callee, 'Effect', 'cachedWithTTL') },
]

const ruleFor = (callee: AridCallee): Option.Option<AridRuleId> =>
  Option.map(
    Option.fromNullishOr(ARID_RULES_IN_PRECEDENCE_ORDER.find((rule) => rule.matches(callee))),
    (rule) => rule.ruleId,
  )

const calleeDetail = (callee: AridCallee): string => `${callee.object}.${callee.member}`

export class AridCodeCommand extends S.TaggedClass<AridCodeCommand>()('AridCodeCommand', {
  policy: Options.MutantSetPolicy,
  frames: S.Array(AridFrameSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const AridCodeDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js-instrumenter/AridCodeDecision',
)
type AridCodeDecisionTypeId = typeof AridCodeDecisionTypeId

export class AridSuppressed extends S.TaggedClass<AridSuppressed>()('AridSuppressed', {
  ruleId: AridRuleId,
  detail: S.String,
}) {
  readonly [AridCodeDecisionTypeId] = AridCodeDecisionTypeId
}

export class AridKept extends S.TaggedClass<AridKept>()('AridKept', {}) {
  readonly [AridCodeDecisionTypeId] = AridCodeDecisionTypeId
}

export type AridCodeDecision = AridSuppressed | AridKept

interface AridMatch {
  readonly ruleId: AridRuleId
  readonly callee: AridCallee
}

const matchOfFrame = (frame: AridFrame): Option.Option<AridMatch> =>
  Option.flatMap(
    Option.filter(frame.callee, () => frame.childIsArgument),
    (callee) => Option.map(ruleFor(callee), (ruleId): AridMatch => ({ ruleId, callee })),
  )

const firstMatch = (frames: readonly AridFrame[]): Option.Option<AridMatch> =>
  Option.firstSomeOf(frames.map(matchOfFrame))

const defaultPolicyDecision = (frames: readonly AridFrame[]): AridCodeDecision =>
  Match.value(firstMatch(frames)).pipe(
    Match.when(Option.isSome, (found) =>
      AridSuppressed.make({ ruleId: found.value.ruleId, detail: calleeDetail(found.value.callee) })),
    Match.when(Option.isNone, () =>
      AridKept.make({})),
    Match.exhaustive,
  )

const decisionFor = (command: AridCodeCommand): AridCodeDecision =>
  Match.value(command.policy).pipe(
    Match.when('default', () => defaultPolicyDecision(command.frames)),
    Match.when('full', () => AridKept.make({})),
    Match.exhaustive,
  )

export const aridCode = Workflow.make({
  command: AridCodeCommand,
  decision: S.Union([AridSuppressed, AridKept]),
  error: S.Never,
  decide: (command: AridCodeCommand): Result.Result<AridCodeDecision, never> => Result.succeed(decisionFor(command)),
})
