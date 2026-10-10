import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
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

export const AridEffectModule = S.Literals(['Effect', 'Logger', 'Metric', 'Schedule', 'Duration', 'Config'])
export type AridEffectModule = typeof AridEffectModule.Type

export const AridGlobalObject = S.Literals(['console'])
export type AridGlobalObject = typeof AridGlobalObject.Type

const AridEffectExportCallee = S.TaggedStruct('EffectExport', {
  module: AridEffectModule,
  exportName: S.String,
})
type AridEffectExportCallee = typeof AridEffectExportCallee.Type

const AridGlobalCallee = S.TaggedStruct('Global', {
  name: AridGlobalObject,
  member: S.String,
})
type AridGlobalCallee = typeof AridGlobalCallee.Type

export const AridCalleeSchema = S.Union([AridEffectExportCallee, AridGlobalCallee])
export type AridCallee = typeof AridCalleeSchema.Type

const AridCallFrame = S.TaggedStruct('CallFrame', {
  callee: S.Option(AridCalleeSchema),
  childIsArgument: S.Boolean,
})
type AridCallFrame = typeof AridCallFrame.Type

const AridFunctionBoundary = S.TaggedStruct('FunctionBoundary', {})

export const AridFrameSchema = S.Union([AridCallFrame, AridFunctionBoundary])
export type AridFrame = typeof AridFrameSchema.Type

interface AridRule {
  readonly ruleId: AridRuleId
  readonly matches: (callee: AridCallee) => boolean
}

const matchCallee = (
  callee: AridCallee,
  arms: {
    readonly effectExport: (effectExport: AridEffectExportCallee) => boolean
    readonly global: (global: AridGlobalCallee) => boolean
  },
): boolean =>
  Match.value(callee).pipe(
    Match.tagsExhaustive({
      EffectExport: arms.effectExport,
      Global: arms.global,
    }),
  )

const readsModule = (callee: AridCallee, module: AridEffectModule): boolean =>
  matchCallee(callee, { effectExport: (effectExport) => effectExport.module === module, global: () => false })

const readsExport = (callee: AridCallee, module: AridEffectModule, exportName: string): boolean =>
  matchCallee(callee, {
    effectExport: (effectExport) =>
      [effectExport.module === module, effectExport.exportName === exportName].every(Boolean),
    global: () => false,
  })

const readsExportPrefixed = (callee: AridCallee, module: AridEffectModule, prefix: string): boolean =>
  matchCallee(callee, {
    effectExport: (effectExport) =>
      [effectExport.module === module, effectExport.exportName.startsWith(prefix)].every(Boolean),
    global: () => false,
  })

const readsGlobal = (callee: AridCallee): boolean =>
  matchCallee(callee, { effectExport: () => false, global: () => true })

const ARID_RULES_IN_PRECEDENCE_ORDER: ReadonlyArray<AridRule> = [
  { ruleId: 'arid-logging', matches: (callee) => readsExportPrefixed(callee, 'Effect', 'log') },
  { ruleId: 'arid-logging', matches: (callee) => readsModule(callee, 'Logger') },
  { ruleId: 'arid-logging', matches: readsGlobal },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExport(callee, 'Effect', 'withSpan') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExportPrefixed(callee, 'Effect', 'annotate') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExport(callee, 'Effect', 'withLogSpan') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsModule(callee, 'Metric') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExport(callee, 'Effect', 'fn') },
  { ruleId: 'arid-time', matches: (callee) => readsExport(callee, 'Effect', 'sleep') },
  { ruleId: 'arid-time', matches: (callee) => readsModule(callee, 'Schedule') },
  { ruleId: 'arid-time', matches: (callee) => readsModule(callee, 'Duration') },
  { ruleId: 'arid-config-default', matches: (callee) => readsExport(callee, 'Config', 'withDefault') },
  { ruleId: 'arid-memoization', matches: (callee) => readsExport(callee, 'Effect', 'cached') },
  { ruleId: 'arid-memoization', matches: (callee) => readsExport(callee, 'Effect', 'cachedWithTTL') },
]

const ruleFor = (callee: AridCallee): Option.Option<AridRuleId> =>
  Option.map(
    Option.fromNullishOr(ARID_RULES_IN_PRECEDENCE_ORDER.find((rule) => rule.matches(callee))),
    (rule) => rule.ruleId,
  )

const calleeDetail = (callee: AridCallee): string =>
  Match.value(callee).pipe(
    Match.tagsExhaustive({
      EffectExport: (effectExport) => `${effectExport.module}.${effectExport.exportName}`,
      Global: (global) => `${global.name}.${global.member}`,
    }),
  )

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

const matchOfFrame = (frame: AridCallFrame): Option.Option<AridMatch> =>
  Option.flatMap(
    Option.filter(frame.callee, () => frame.childIsArgument),
    (callee) =>
      Option.map(
        ruleFor(callee),
        (ruleId): AridMatch => ({ ruleId, callee }),
      ),
  )

const firstMatch = (frames: readonly AridFrame[]): Option.Option<AridMatch> =>
  Option.firstSomeOf(Arr.takeWhile(frames, S.is(AridCallFrame)).map(matchOfFrame))

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
