import { SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import type { MutantStatus, RememberedStatus } from './Mutant.schema.js'

type Sentence = `${string}.`

type SlashFreeCodeDocumentation<Code extends string> = {
  readonly [code in Code]: code extends `${string}/${string}` ? never : Sentence
}

type Codes = readonly [string, ...Array<string>]

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

const RULE_DOCUMENTATION: SlashFreeCodeDocumentation<(typeof RULE_IDS)[number]> = {
  'arid-logging': `The mutant sits in a logging call (console.*, Logger, Effect.log*). ${KEEP_ALL}`,
  'arid-telemetry': `The mutant sits in a telemetry span or annotation (Effect.withSpan, annotate). ${KEEP_ALL}`,
  'arid-time': `The mutant sits in a time or schedule value (Duration, Schedule, Date.now). ${KEEP_ALL}`,
  'arid-config-default': `The mutant sits in a config default (Config.withDefault). ${KEEP_ALL}`,
  'arid-memoization': `The mutant sits in a memoization wrapper (Effect.cached*). ${KEEP_ALL}`,
  'redundant-relational': `Another mutant at the same relational operator already covers this one. ${KEEP_ALL}`,
  'equivalent-to-original':
    `The mutant behaves exactly like the original code, so no test can kill it. ${KEEP_ALL} With detail \`tce\`, the TypeScript checker compiled it to the original's output; remove that checker from \`checkers\` to keep it.`,
  'duplicate-at-site':
    `Another mutant at the same site produces the same code. ${KEEP_ALL} With detail \`tce\`, the TypeScript checker compiled both to the same output; remove that checker from \`checkers\` to keep it.`,
  'ignore-static': 'The mutant is static (it runs once at module load). To keep it, set `ignoreStatic: false`.',
  directive: 'A `// Stryker disable` comment covers the mutant. To keep it, remove or narrow the comment.',
  'excluded-mutator': 'Its mutator is listed in `mutator.excludedMutations`. To keep it, remove it from that list.',
  ignorer:
    "An ignorer plugin from `ignorers` removed it; the detail is the plugin's reason, which a plugin with codes of its own starts with `<plugin>/<code>: `. To keep it, remove that plugin or change its rule.",
  checker: 'A checker plugin from `checkers` ignored it. To keep it, remove that plugin or change its rule.',
}

type SettledStatus = Exclude<MutantStatus, 'Ignored' | 'Pending'>

const SETTLED_CODES_BY_STATUS = {
  Killed: ['killed', 'remembered'],
  Survived: ['covered-not-killed', 'coverage-not-measured', 'remembered'],
  NoCoverage: ['not-covered', 'remembered'],
  Timeout: ['timed-out', 'remembered'],
  RuntimeError: ['runtime-error'],
  CompileError: ['compile-error', 'remembered'],
} as const satisfies { readonly [status in SettledStatus]: Codes }

const SETTLED_CODES = Arr.dedupe(Object.values(SETTLED_CODES_BY_STATUS).flat())

const SETTLED_DOCUMENTATION: SlashFreeCodeDocumentation<(typeof SETTLED_CODES)[number]> = {
  'covered-not-killed':
    'Survived: the tests that cover the mutant ran and none failed. Strengthen an assertion in one of its covering tests.',
  'coverage-not-measured':
    'Survived: coverage analysis was off, so every test ran, none failed, and the run cannot name the covering tests. Set `coverageAnalysis: perTest` to learn them.',
  'not-covered': "NoCoverage: no test executes the mutant's location. Add a test that reaches it.",
  'timed-out':
    'Timeout: a test run with the mutant active exceeded its limit; the detail keeps the wall-clock or hit-limit text. A timeout counts as detected.',
  'runtime-error':
    'RuntimeError: the test run crashed with the mutant active; the detail is the error message. It is left out of the score.',
  'compile-error':
    "CompileError: the mutant does not compile; the detail is the checker's or runner's message. It is left out of the score.",
  killed: 'Killed: a test failed with the mutant active; the detail is the failure message.',
  remembered:
    "The status comes from the previous run's report, and the mutant did not run again; the detail names that run's code when it had one. Run with `--full` to run it again. A reused Ignored mutant keeps its rule code instead.",
}

const RUN_FAILURE_CODES = [
  'initial-test-run-failed',
  'config-invalid',
  'plugin-load-failed',
  'shard-reports-missing',
  'shard-reports-overlap',
  'score-below-break',
  'new-survivors',
  'budget-exceeded',
  'mutation-runs-on-main-ci',
] as const

const RUN_FAILURE_DOCUMENTATION: SlashFreeCodeDocumentation<(typeof RUN_FAILURE_CODES)[number]> = {
  'initial-test-run-failed':
    'The test suite failed before any mutant ran, so no mutant was judged. Fix the failing tests the detail names.',
  'config-invalid': 'The Stryker configuration does not decode; the detail names the option. Fix that option.',
  'plugin-load-failed':
    'A plugin did not load; the detail begins with its plugin-load failure reason (a missing, unsupported or unrecognised peer). Install or fix what it names.',
  'shard-reports-missing':
    '`stryker merge` lacks a report for a planned shard; the detail names the missing mutants. Re-run the shards that hold them.',
  'shard-reports-overlap':
    '`stryker merge` found one mutant in two shard reports; the detail names it. Re-run the shards from one plan.',
  'score-below-break':
    'The mutation score fell below `thresholds.break`; the detail gives the score and the threshold. Kill survivors or lower the threshold.',
  'new-survivors':
    '`stryker gate` found survivors absent from the committed baseline; the detail lists them. Kill them, or update the baseline when they are accepted.',
  'budget-exceeded':
    'The run took longer than the budget baseline allows; the detail gives the actual and allowed seconds. Speed the run up or update the baseline.',
  'mutation-runs-on-main-ci': 'A local mutation run was refused: mutation runs only on main CI. Read its CI report.',
}

const TOOL_REFUSAL_CODES = [
  'report-missing',
  'report-unreadable',
  'unknown-mutant-id',
  'cursor-stale',
  'rerun-refused',
] as const

const TOOL_REFUSAL_DOCUMENTATION: SlashFreeCodeDocumentation<(typeof TOOL_REFUSAL_CODES)[number]> = {
  'report-missing': 'The finished mutation report the tool reads does not exist. Run `stryker run` first.',
  'report-unreadable':
    'The mutation report does not decode; the detail names the problem. Run `stryker run` to write it again.',
  'unknown-mutant-id':
    'No mutant in the report has the id asked for; the detail names it. Ask for an id the report lists.',
  'cursor-stale': 'The page cursor belongs to a different report or filter. Restart paging without a cursor.',
  'rerun-refused': 'The rerun was refused; the detail says why. Fix what it names, then rerun.',
}

const STABLE_CODE = 'A stable code shared by every consumer: renaming or removing one is a breaking change.'

export const IgnoreRuleId = S.Literals(RULE_IDS).mapMembers(
  (members) => members.map((member) => member.annotate({ description: RULE_DOCUMENTATION[member.literal] })),
).annotate({ description: `Why an Ignored mutant was removed. ${STABLE_CODE}` })
export type IgnoreRuleId = typeof IgnoreRuleId.Type

export const SettledReasonCode = S.Literals(SETTLED_CODES).mapMembers(
  (members) => members.map((member) => member.annotate({ description: SETTLED_DOCUMENTATION[member.literal] })),
).annotate({ description: `Why a mutant that was judged has its status. ${STABLE_CODE}` })
export type SettledReasonCode = typeof SettledReasonCode.Type

export const RunFailureCode = S.Literals(RUN_FAILURE_CODES).mapMembers(
  (members) => members.map((member) => member.annotate({ description: RUN_FAILURE_DOCUMENTATION[member.literal] })),
).annotate({ description: `Why a run failed or was refused. ${STABLE_CODE}` })
export type RunFailureCode = typeof RunFailureCode.Type

export const ToolRefusalCode = S.Literals(TOOL_REFUSAL_CODES).mapMembers(
  (members) => members.map((member) => member.annotate({ description: TOOL_REFUSAL_DOCUMENTATION[member.literal] })),
).annotate({ description: `Why a CLI or MCP query was refused. ${STABLE_CODE}` })
export type ToolRefusalCode = typeof ToolRefusalCode.Type

const SEPARATOR = ': '

const asLiteralPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const reasonPatternOf = (codes: Codes) => {
  const source = `^(?:${codes.map(asLiteralPattern).join('|')})${SEPARATOR}[\\s\\S]*$`
  return S.isPattern(new RegExp(source, 'u'), { arbitraryConstraint: { patterns: [{ source, flags: 'u' }] } })
}

const malformedReason = (text: string) =>
  new SchemaIssue.InvalidValue({ message: `expected "<code>${SEPARATOR}<detail>"` }, text)

const reasonPartsOf = <const L extends Codes>(codes: L) => {
  const Parts = S.Struct({ code: S.Literals(codes), detail: S.String })
  type Parts = typeof Parts.Type
  const partsOf = (text: string): Option.Option<Parts> =>
    Option.map(
      Option.fromNullishOr(codes.find((code) => text.startsWith(code) && text.startsWith(SEPARATOR, code.length))),
      (code): Parts => ({ code, detail: text.slice(code.length + SEPARATOR.length) }),
    )
  const transformation = SchemaTransformation.makeTransformation({
    decode: SchemaGetter.transformEffect((text: string) =>
      Effect.fromOption(partsOf(text), () => malformedReason(text))
    ),
    encode: SchemaGetter.transform((parts: Parts) => `${parts.code}${SEPARATOR}${parts.detail}`),
  })
  return { Parts, transformation }
}

export const IgnoreStatusReasonText = S.String.check(reasonPatternOf(RULE_IDS))

export const IgnoreStatusReason = IgnoreStatusReasonText.pipe(
  S.decodeTo(S.Struct({ code: IgnoreRuleId, detail: S.String }), reasonPartsOf(RULE_IDS).transformation),
)
export type IgnoreStatusReason = typeof IgnoreStatusReason.Type

export const ignoreStatusReasonText = (parts: IgnoreStatusReason): string => `${parts.code}${SEPARATOR}${parts.detail}`

type ReusedSettledStatus = Exclude<RememberedStatus, 'Ignored'>

type CodesTiedToReuse<Status extends SettledStatus, L extends Codes> =
  ('remembered' extends L[number] ? true : false) extends (Status extends ReusedSettledStatus ? true : false) ? L
    : never

const settledVariantOf = <const Status extends SettledStatus, const L extends ReadonlyArray<SettledReasonCode> & Codes>(
  status: Status,
  codes: L & CodesTiedToReuse<Status, L>,
) => {
  const admitted: L = codes
  const { Parts, transformation } = reasonPartsOf(admitted)
  return S.Struct({
    status: S.Literal(status),
    statusReason: S.String.check(reasonPatternOf(admitted)).pipe(S.decodeTo(Parts, transformation)),
  })
}

export const StatusReason = S.Union([
  S.Struct({ status: S.Literal('Ignored'), statusReason: IgnoreStatusReason }),
  settledVariantOf('Killed', SETTLED_CODES_BY_STATUS.Killed),
  settledVariantOf('Survived', SETTLED_CODES_BY_STATUS.Survived),
  settledVariantOf('NoCoverage', SETTLED_CODES_BY_STATUS.NoCoverage),
  settledVariantOf('Timeout', SETTLED_CODES_BY_STATUS.Timeout),
  settledVariantOf('RuntimeError', SETTLED_CODES_BY_STATUS.RuntimeError),
  settledVariantOf('CompileError', SETTLED_CODES_BY_STATUS.CompileError),
]).annotate({
  description:
    'A mutant status with its reason, `<code>: <detail>` decoded to `{ code, detail }`. Each status admits only its own codes; a Pending mutant has no reason.',
}).pipe(S.toTaggedUnion('status'))
export type StatusReason = typeof StatusReason.Type

const acceptsIgnoreStatusReason = (value: string): boolean => S.is(IgnoreStatusReasonText)(value)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { MutantStatusSchema } = await import('./Mutant.schema.js')
  const Equal = await import('effect/Equal')
  const Record = await import('effect/Record')

  const decodeStatusReason = S.decodeUnknownOption(StatusReason)

  const decodedStatusReasonOf = (
    status: string,
    statusReason: string,
  ): { readonly code: string; readonly detail: string } | null =>
    Option.getOrNull(
      Option.map(
        decodeStatusReason({ status, statusReason }),
        (decoded) => ({ code: decoded.statusReason.code, detail: decoded.statusReason.detail }),
      ),
    )

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
    'ignorer: effect-schema-declarations/tagged-tag: a declaration discriminant',
    'effect-schema-declarations/tagged-tag: a declaration discriminant',
    'covered-not-killed: 2 covering tests ran, none failed',
  ]
  const withReasonBoundaries = (drawn: string): ReadonlyArray<string> => Arr.prepend(reasonBoundaries, drawn)

  const readsAsReason = (value: string): boolean => RULE_IDS.some((ruleId) => value.startsWith(`${ruleId}${SEPARATOR}`))

  it.prop(
    '∀t_ReasonTextRefusal_≡RuleIdFromTheClosedVocabularyThenDetail',
    { of: [S.String], subject: acceptsIgnoreStatusReason },
    (subject, [drawn]) => Arr.every(withReasonBoundaries(drawn), (value) => subject(value) === readsAsReason(value)),
  )

  type Decoded = { readonly code: string; readonly detail: string } | null

  const codesByStatus: { readonly [status: string]: ReadonlyArray<string> } = {
    Ignored: RULE_IDS,
    ...SETTLED_CODES_BY_STATUS,
  }

  const codesOf = (status: string): ReadonlyArray<string> =>
    Option.getOrElse(Record.get(codesByStatus, status), () => [])

  const readsAsStatusReason = (status: string, text: string): Decoded =>
    Option.getOrNull(
      Option.map(
        Option.fromNullishOr(codesOf(status).find((code) => text.startsWith(`${code}${SEPARATOR}`))),
        (code) => ({ code, detail: text.slice(code.length + SEPARATOR.length) }),
      ),
    )

  const statusProbes: ReadonlyArray<string> = [...MutantStatusSchema.literals, 'NotAStatus', 'survived']
  const everyCode: ReadonlyArray<string> = [
    ...RULE_IDS,
    ...SETTLED_CODES,
    ...RUN_FAILURE_CODES,
    ...TOOL_REFUSAL_CODES,
    'slow',
    'Remembered',
    'covered-not-killed/strict',
  ]
  const textsOf = (drawn: string): ReadonlyArray<string> => [
    drawn,
    ...everyCode.map((code) => `${code}${SEPARATOR}${drawn}`),
    ...everyCode.map((code) => `${code}:${drawn}`),
    ...everyCode,
  ]

  const examples: ReadonlyArray<readonly [status: string, text: string, decoded: Decoded]> = [
    [
      'Survived',
      'covered-not-killed: 2 covering tests ran, none failed',
      { code: 'covered-not-killed', detail: '2 covering tests ran, none failed' },
    ],
    ['Survived', 'coverage-not-measured: coverageAnalysis is off', {
      code: 'coverage-not-measured',
      detail: 'coverageAnalysis is off',
    }],
    [
      'Survived',
      'remembered: covered-not-killed in the previous run',
      { code: 'remembered', detail: 'covered-not-killed in the previous run' },
    ],
    ['NoCoverage', 'not-covered: src/calc.ts:3:5', { code: 'not-covered', detail: 'src/calc.ts:3:5' }],
    ['Timeout', 'timed-out: hit limit reached (5000 ms)', { code: 'timed-out', detail: 'hit limit reached (5000 ms)' }],
    ['RuntimeError', 'runtime-error: TypeError: x is not a function', {
      code: 'runtime-error',
      detail: 'TypeError: x is not a function',
    }],
    ['CompileError', 'compile-error: TS2322: Type string is not assignable', {
      code: 'compile-error',
      detail: 'TS2322: Type string is not assignable',
    }],
    ['Killed', 'killed: expected 3 to be 4', { code: 'killed', detail: 'expected 3 to be 4' }],
    [
      'Ignored',
      'ignorer: effect-schema-declarations/tagged-tag: TaggedClass/TaggedError _tag is a declaration discriminant, not behaviour',
      {
        code: 'ignorer',
        detail:
          'effect-schema-declarations/tagged-tag: TaggedClass/TaggedError _tag is a declaration discriminant, not behaviour',
      },
    ],
    ['Survived', 'covered-not-killed', null],
    ['Survived', 'slow: the covering tests took 9 s', null],
    ['Survived', 'Remembered', null],
    ['Killed', 'Remembered', null],
    ['Ignored', 'covered-not-killed: 2 covering tests ran, none failed', null],
    ['Killed', 'covered-not-killed: 2 covering tests ran, none failed', null],
    ['Ignored', 'effect-schema-declarations/tagged-tag: a declaration discriminant', null],
    ['Survived', 'covered-not-killed/strict: no assertion', null],
    ['Killed', 'remembered: killed in the previous run', { code: 'remembered', detail: 'killed in the previous run' }],
    ['NoCoverage', 'remembered: not-covered in the previous run', {
      code: 'remembered',
      detail: 'not-covered in the previous run',
    }],
    ['Timeout', 'remembered: timed-out in the previous run', {
      code: 'remembered',
      detail: 'timed-out in the previous run',
    }],
    ['CompileError', 'remembered: compile-error in the previous run', {
      code: 'remembered',
      detail: 'compile-error in the previous run',
    }],
    ['RuntimeError', 'remembered: runtime-error in the previous run', null],
    ['Ignored', 'remembered: directive: consecutive run', null],
    ['Pending', 'remembered: covered-not-killed in the previous run', null],
    ['Survived', 'score-below-break: 42 < 60', null],
    ['Survived', 'unknown-mutant-id: 0123456789abcdef', null],
  ]

  it.prop(
    '∀t_StatusReasonRefusal_≡ACodeOfThatStatusThenDetail',
    { of: [S.String], subject: decodedStatusReasonOf },
    (subject, [drawn]) => {
      const texts = textsOf(drawn)
      return Arr.every(examples, ([status, text, decoded]) => Equal.equals(subject(status, text), decoded)) &&
        Arr.every(
          statusProbes,
          (status) =>
            Arr.every(texts, (text) => Equal.equals(subject(status, text), readsAsStatusReason(status, text))),
        )
    },
  )

  const mainIgnoredTexts: ReadonlyArray<string> = [
    'ignore-static: Static mutant (and "ignoreStatic" was enabled)',
    'excluded-mutator: Ignored because of excluded mutation "ArithmeticOperator"',
  ]

  const encodeStatusReason = S.encodeOption(StatusReason)

  const reEncodedStatusReasonOf = (status: string, statusReason: string): string | null =>
    Option.getOrNull(
      Option.map(
        Option.flatMap(decodeStatusReason({ status, statusReason }), encodeStatusReason),
        (encoded) => encoded.statusReason,
      ),
    )

  it.prop(
    '∀t_StatusReasonRoundTrip_≡EncodeGivesBackTheText',
    { of: [S.String], subject: reEncodedStatusReasonOf },
    (subject, [drawn]) =>
      Arr.every(
        [
          ...examples.flatMap(([status, text, decoded]) => decoded === null ? [] : [[status, text] as const]),
          ...mainIgnoredTexts.map((text) => ['Ignored', text] as const),
          ...Object.entries(codesByStatus).flatMap(([status, codes]) =>
            codes.map((code) => [status, `${code}${SEPARATOR}${drawn}`] as const)
          ),
        ],
        ([status, text]) => subject(status, text) === text,
      ),
  )

  const decodeIgnoreStatusReason = S.decodeUnknownOption(IgnoreStatusReason)
  const encodeIgnoreStatusReason = S.encodeOption(IgnoreStatusReason)

  const reEncodedIgnoreStatusReasonOf = (text: string): string | null =>
    Option.getOrNull(Option.flatMap(decodeIgnoreStatusReason(text), encodeIgnoreStatusReason))

  it.prop(
    '∀t_IgnoreStatusReasonRoundTrip_≡EncodeGivesBackTheText',
    { of: [S.String], subject: reEncodedIgnoreStatusReasonOf },
    (subject, [drawn]) =>
      Arr.every(
        [...mainIgnoredTexts, ...RULE_IDS.map((ruleId) => `${ruleId}${SEPARATOR}${drawn}`)],
        (text) => subject(text) === text,
      ),
  )
}
