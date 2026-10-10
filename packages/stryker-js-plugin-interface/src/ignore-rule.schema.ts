import { SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const RULE_IDS = [
  'arid-logging',
  'arid-telemetry',
  'arid-time',
  'arid-config-default',
  'arid-memoization',
  'redundant-relational',
  'equivalent-to-original',
  'duplicate-at-site',
  'ignore-static',
  'directive',
  'excluded-mutator',
  'ignorer',
  'checker',
] as const

const KEEP_ALL = "To keep these mutants, set `mutator.mutantSetPolicy: 'full'`."

const ARID_CALLEE =
  'The callee must come from an `effect` import under any local name; `console` and `Date` count only when nothing in scope rebinds them. The detail names the canonical callee, such as `Effect.logInfo`.'

const RULE_DOCUMENTATION: { readonly [ruleId in (typeof RULE_IDS)[number]]: string } = {
  'arid-logging': `The mutant sits in a logging call (console.*, Logger, Effect.log*). ${ARID_CALLEE} ${KEEP_ALL}`,
  'arid-telemetry':
    `The mutant sits in a telemetry span, annotation or metric (Effect.withSpan, annotate*, withLogSpan, Metric), or in the span name and options of \`Effect.fn('name', options)\`; the function body is never covered. ${ARID_CALLEE} ${KEEP_ALL}`,
  'arid-time':
    `The mutant sits in a time or schedule value (Duration, Schedule, Effect.sleep, Date.now). ${ARID_CALLEE} ${KEEP_ALL}`,
  'arid-config-default': `The mutant sits in a config default (Config.withDefault). ${ARID_CALLEE} ${KEEP_ALL}`,
  'arid-memoization': `The mutant sits in a memoization wrapper (Effect.cached*). ${ARID_CALLEE} ${KEEP_ALL}`,
  'redundant-relational': `Another mutant at the same relational operator already covers this one. ${KEEP_ALL}`,
  'equivalent-to-original':
    `The mutant behaves exactly like the original code, so no test can kill it. ${KEEP_ALL} With detail \`tce\`, the TypeScript checker compiled it to the original's output; remove that checker from \`checkers\` to keep it.`,
  'duplicate-at-site':
    `Another mutant at the same site produces the same code. ${KEEP_ALL} With detail \`tce\`, the TypeScript checker compiled both to the same output; remove that checker from \`checkers\` to keep it.`,
  'ignore-static': 'The mutant is static (it runs once at module load). To keep it, set `ignoreStatic: false`.',
  directive: 'A `// Stryker disable` comment covers the mutant. To keep it, remove or narrow the comment.',
  'excluded-mutator': 'Its mutator is listed in `mutator.excludedMutations`. To keep it, remove it from that list.',
  ignorer: 'An ignorer plugin from `ignorers` removed it. To keep it, remove that plugin or change its rule.',
  checker: 'A checker plugin from `checkers` ignored it. To keep it, remove that plugin or change its rule.',
}

export const IgnoreRuleId = S.Literals(RULE_IDS).mapMembers(
  (members) => members.map((member) => member.annotate({ description: RULE_DOCUMENTATION[member.literal] })),
).annotate({
  description:
    'Why an Ignored mutant was removed. A stable code shared by every consumer: renaming or removing one is a breaking change.',
})
export type IgnoreRuleId = typeof IgnoreRuleId.Type

const SEPARATOR = ': '

const asLiteralPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const RULE_ID_ALTERNATION = RULE_IDS.map(asLiteralPattern).join('|')

const REASON_SOURCE = `^(?:${RULE_ID_ALTERNATION})${SEPARATOR}[\\s\\S]*$`

export const IgnoreStatusReasonText = S.String.check(
  S.isPattern(new RegExp(REASON_SOURCE, 'u'), {
    arbitraryConstraint: { patterns: [{ source: REASON_SOURCE, flags: 'u' }] },
  }),
)

const ReasonPartsSchema = S.Struct({ ruleId: IgnoreRuleId, detail: S.String })
type ReasonParts = typeof ReasonPartsSchema.Type

export const ignoreStatusReasonText = (parts: ReasonParts): string => `${parts.ruleId}${SEPARATOR}${parts.detail}`

const reasonPartsOf = (text: string): Option.Option<ReasonParts> =>
  Option.map(
    Option.fromNullishOr(RULE_IDS.find((ruleId) => text.startsWith(`${ruleId}${SEPARATOR}`))),
    (ruleId): ReasonParts => ({ ruleId, detail: text.slice(ruleId.length + SEPARATOR.length) }),
  )

const malformedReason = (text: string) =>
  new SchemaIssue.InvalidValue({ message: `expected "<rule-id>${SEPARATOR}<detail>"` }, text)

const partsOf = SchemaGetter.transformEffect((text: string) =>
  Effect.fromOption(reasonPartsOf(text), () => malformedReason(text))
)

const textOf = SchemaGetter.transform(ignoreStatusReasonText)

export const IgnoreStatusReason = IgnoreStatusReasonText.pipe(
  S.decodeTo(ReasonPartsSchema, SchemaTransformation.makeTransformation({ decode: partsOf, encode: textOf })),
)
export type IgnoreStatusReason = typeof IgnoreStatusReason.Type

const acceptsIgnoreStatusReason = (value: string): boolean => S.is(IgnoreStatusReasonText)(value)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const reasonBoundaries: ReadonlyArray<string> = [
    '',
    'arid-logging: ',
    'arid-memoization: an unobserved memo read is arid',
    'directive: consecutive run',
    'ignored',
    'ignorer: the provider said so',
    'ignorer: ',
    'ignore-static: Static mutant (and "ignoreStatic" was enabled)',
    'excluded-mutator: Ignored because of excluded mutation "ArithmeticOperator"',
    'duplicate-at-site: the same replacement is already planted here',
    'directive: a detail carrying "colon: space"',
    ' Directive: x',
    'Directive: x',
    'directive:',
    'directive:x',
    'directive : x',
    'xdirective: x',
    'ignore-staticx: x',
    'ignorers: x',
    'checker: the third-party checker proved it equivalent',
    'checkers: x',
    'arid-time',
    'arid-time:',
  ]
  const withReasonBoundaries = (drawn: string): ReadonlyArray<string> => Arr.prepend(reasonBoundaries, drawn)

  const readsAsReason = (value: string): boolean => RULE_IDS.some((ruleId) => value.startsWith(`${ruleId}${SEPARATOR}`))

  it.prop(
    '∀t_ReasonTextRefusal_≡RuleIdFromTheClosedVocabularyThenDetail',
    { of: [S.String], subject: acceptsIgnoreStatusReason },
    (subject, [drawn]) => Arr.every(withReasonBoundaries(drawn), (value) => subject(value) === readsAsReason(value)),
  )
}
