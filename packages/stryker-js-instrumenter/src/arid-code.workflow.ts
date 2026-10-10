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

export const AridEffectModule = S.Literals(['Effect', 'Logger', 'Metric', 'Schedule', 'Duration', 'Config'])
export type AridEffectModule = typeof AridEffectModule.Type

export const AridGlobalObject = S.Literals(['console', 'Date'])
export type AridGlobalObject = typeof AridGlobalObject.Type

export const AridEffectExportCallee = S.TaggedStruct('EffectExport', {
  module: AridEffectModule,
  exportName: S.String,
})
export type AridEffectExportCallee = typeof AridEffectExportCallee.Type

export const AridGlobalCallee = S.TaggedStruct('Global', {
  name: AridGlobalObject,
  member: S.String,
})
export type AridGlobalCallee = typeof AridGlobalCallee.Type

export const AridCalleeSchema = S.Union([AridEffectExportCallee, AridGlobalCallee])
export type AridCallee = typeof AridCalleeSchema.Type

export const AridFrameSchema = S.Struct({
  callee: S.Option(AridCalleeSchema),
  childIsArgument: S.Boolean,
  firstArgumentIsString: S.Boolean,
})
export type AridFrame = typeof AridFrameSchema.Type

interface AridRule {
  readonly ruleId: AridRuleId
  readonly matches: (callee: AridCallee, firstArgumentIsString: boolean) => boolean
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

const readsGlobal = (callee: AridCallee, name: AridGlobalObject): boolean =>
  matchCallee(callee, { effectExport: () => false, global: (global) => global.name === name })

const readsGlobalMember = (callee: AridCallee, name: AridGlobalObject, member: string): boolean =>
  matchCallee(callee, {
    effectExport: () => false,
    global: (global) => [global.name === name, global.member === member].every(Boolean),
  })

const ARID_RULES_IN_PRECEDENCE_ORDER: ReadonlyArray<AridRule> = [
  { ruleId: 'arid-logging', matches: (callee) => readsExportPrefixed(callee, 'Effect', 'log') },
  { ruleId: 'arid-logging', matches: (callee) => readsModule(callee, 'Logger') },
  { ruleId: 'arid-logging', matches: (callee) => readsGlobal(callee, 'console') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExport(callee, 'Effect', 'withSpan') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExportPrefixed(callee, 'Effect', 'annotate') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsExport(callee, 'Effect', 'withLogSpan') },
  { ruleId: 'arid-telemetry', matches: (callee) => readsModule(callee, 'Metric') },
  {
    ruleId: 'arid-telemetry',
    matches: (callee, firstArgumentIsString) =>
      [readsExport(callee, 'Effect', 'fn'), firstArgumentIsString].every(Boolean),
  },
  { ruleId: 'arid-time', matches: (callee) => readsExport(callee, 'Effect', 'sleep') },
  { ruleId: 'arid-time', matches: (callee) => readsModule(callee, 'Schedule') },
  { ruleId: 'arid-time', matches: (callee) => readsModule(callee, 'Duration') },
  { ruleId: 'arid-time', matches: (callee) => readsGlobalMember(callee, 'Date', 'now') },
  { ruleId: 'arid-config-default', matches: (callee) => readsExport(callee, 'Config', 'withDefault') },
  { ruleId: 'arid-memoization', matches: (callee) => readsExport(callee, 'Effect', 'cached') },
  { ruleId: 'arid-memoization', matches: (callee) => readsExport(callee, 'Effect', 'cachedWithTTL') },
]

const ruleFor = (callee: AridCallee, firstArgumentIsString: boolean): Option.Option<AridRuleId> =>
  Option.map(
    Option.fromNullishOr(
      ARID_RULES_IN_PRECEDENCE_ORDER.find((rule) => rule.matches(callee, firstArgumentIsString)),
    ),
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

const matchOfFrame = (frame: AridFrame): Option.Option<AridMatch> =>
  Option.flatMap(
    Option.filter(frame.callee, () => frame.childIsArgument),
    (callee) =>
      Option.map(
        ruleFor(callee, frame.firstArgumentIsString),
        (ruleId): AridMatch => ({ ruleId, callee }),
      ),
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
