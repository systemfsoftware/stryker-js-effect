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
] as const

export const IgnoreRuleId = S.Literals(RULE_IDS)
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

const textOf = SchemaGetter.transform((parts: ReasonParts): string => `${parts.ruleId}${SEPARATOR}${parts.detail}`)

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
