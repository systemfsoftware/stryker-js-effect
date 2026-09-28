/// <reference types="vitest/importMeta" />
import { Effect, SchemaGetter, SchemaTransformation } from 'effect'
import * as S from 'effect/Schema'
import { NonNegativeFinite, NonNegativeInt, Percentage } from './Metrics.schema.js'
import { MutatorNameGrammar } from './Mutant.schema.js'

export const StrykerCoverageAnalysis = S.Literal('perTest')

export const StrykerFileLogLevel = S.Literal('off')

export const StrykerLogLevel = S.Literal('info')

export const StrykerTempDirName = S.Literal('.stryker-tmp')

/**
 * The Stryker option set, declared as ONE Effect Schema.
 *
 * Replaces the vendored `schema/stryker-core.json` codegen chain
 * (`tasks/generate-stryker-core.mjs` → `src-generated/stryker-core.ts`): every
 * option name, type, optionality and default is preserved, and
 * the JSON Schema document is **derived** from
 * `StrykerOptionsSchema` (no file read).
 *
 * Layering mirrors the original document:
 * - objects without `additionalProperties: false` there (the option set
 *   itself, `commandRunner`, `clearTextReporter`, `warnings`) are open here —
 *   `S.StructWithRest` with a `Record<string, unknown>` index keeps arbitrary
 *   plugin-proposed keys and makes the decoded type carry
 *   `[k: string]: unknown`;
 * - objects with `additionalProperties: false` (`htmlReporter`, `jsonReporter`,
 *   `thresholds`, `mutator`) are closed here.
 *
 * `dashboard` and `eventReporter` are absent: the reporters they configured were
 * removed, and the removed-option check rejects both names. Declaring them here
 * with defaults meant the default option set carried two options the very next
 * validation step refused - invisible only while the defaults were filled by a
 * separate engine that happened not to inject them.
 */

/** Open object: fixed fields plus an index signature accepting arbitrary plugin keys. */
const openStruct = <const F extends S.Struct.Fields>(fields: F) =>
  S.StructWithRest(S.Struct(fields), [
    S.Record(S.String, S.Unknown),
  ])

/**
 * Field that decodes to a value but defaults when the key is absent.
 *
 * The default is typed by the schema's ENCODED side, which is what
 * `withDecodingDefaultKey` consumes: a whole-object option can therefore default
 * to `{}` exactly when every field inside it carries its own default, and
 * the compiler decides that rather than the author asserting it.
 *
 * The annotation is applied to the schema BEFORE the default transform wraps it.
 * Annotating the wrapper instead leaves `default` off the derived JSON Schema
 * document, so a consumer filling defaults from that document (ajv
 * `useDefaults`) silently injects nothing.
 */
const defaulted = <S2 extends S.Top>(schema: S2, defaultValue: S2['Encoded']) => {
  const annotated = schema.annotate({ default: defaultValue })
  const withDefault = S.withDecodingDefaultKey<typeof annotated>(Effect.succeed(defaultValue))(annotated)
  return withDefault
}

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const LogLevel = S.Literals(['off', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
export const CoverageAnalysisMode = S.Literals(['off', 'all', 'perTest'])
export const ReportType = S.Literals(['full', 'mutationScore'])
export const PackageManager = S.Literals(['npm', 'yarn', 'pnpm'])
export const MutantSetPolicy = S.Literals(['default', 'full'])

/** The generated module exported these as TypeScript types; consumers still name them that way. */
export type LogLevel = typeof LogLevel.Type
export type CoverageAnalysisMode = typeof CoverageAnalysisMode.Type
export type ReportType = typeof ReportType.Type
export type PackageManager = typeof PackageManager.Type
export type MutantSetPolicy = typeof MutantSetPolicy.Type

export const CommandRunnerOptionsSchema = openStruct({
  command: defaulted(S.String, 'npm test'),
})
export type CommandRunnerOptions = S.Schema.Type<typeof CommandRunnerOptionsSchema>

const ClearTextReporterOptions = openStruct({
  allowColor: defaulted(S.Boolean, true),
  allowEmojis: defaulted(S.Boolean, false),
  logTests: defaulted(S.Boolean, true),
  maxTestsToLog: defaulted(NonNegativeInt, 3),
  reportTests: defaulted(S.Boolean, true),
  reportMutants: defaulted(S.Boolean, true),
  reportScoreTable: defaulted(S.Boolean, true),
  skipFull: defaulted(S.Boolean, false),
})

const HtmlReporterOptions = S.Struct({
  fileName: defaulted(S.String, 'reports/mutation/mutation.html'),
})

const JsonReporterOptions = S.Struct({
  fileName: defaulted(S.String, 'reports/mutation/mutation.json'),
})

const MutationScoreThresholdsValuesSchema = S.Struct({
  high: defaulted(Percentage, 80),
  low: defaulted(Percentage, 60),
  break: defaulted(S.NullOr(Percentage), null),
})

const OrderedThresholdsValuesSchema = S.Struct({
  high: Percentage,
  low: Percentage,
  break: S.NullOr(Percentage),
})
type OrderedThresholdsValues = typeof OrderedThresholdsValuesSchema.Type

const isOrderedThresholds = (value: unknown): value is OrderedThresholdsValues =>
  S.is(OrderedThresholdsValuesSchema)(value) && value.low <= value.high

const OrderedThresholds = S.declare<OrderedThresholdsValues>(isOrderedThresholds, {
  message: 'a mutation score threshold pair has low at or below high',
  toCodecArbitrary: () =>
    S.link<OrderedThresholdsValues>()(OrderedThresholdsValuesSchema, {
      decode: SchemaGetter.transform(({ break: breaking, high, low }) => ({
        break: breaking,
        high: Math.max(high, low),
        low: Math.min(high, low),
      })),
      encode: SchemaGetter.transform((thresholds) => thresholds),
    }),
})

export const MutationScoreThresholdsSchema = MutationScoreThresholdsValuesSchema.pipe(
  S.decodeTo(OrderedThresholds, SchemaTransformation.passthrough()),
)
export type MutationScoreThresholds = typeof MutationScoreThresholdsSchema.Type

const isUnitInterval = (value: number): boolean => 0 <= value && value <= 100

const isPercentage = (value: number): boolean => Number.isFinite(value) && isUnitInterval(value)

const isPercentagePair = (high: number, low: number): boolean => isPercentage(high) && isPercentage(low)

const isOrderedPercentagePair = (high: number, low: number): boolean => isPercentagePair(high, low) && low <= high

const acceptsThresholdPair = (high: number, low: number): boolean =>
  S.is(MutationScoreThresholdsSchema)({ high, low, break: null })

const MutatorDescriptor = S.Struct({
  excludedMutations: defaulted(S.Array(MutatorNameGrammar), []),
  optInMutations: defaulted(S.Array(MutatorNameGrammar), []),
  mutantSetPolicy: defaulted(MutantSetPolicy, 'default'),
})

const WarningOptions = openStruct({
  unknownOptions: defaulted(S.Boolean, true),
  preprocessorErrors: defaulted(S.Boolean, true),
  unserializableOptions: defaulted(S.Boolean, true),
  slow: defaulted(S.Boolean, true),
})
const ConcurrencyCount = S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1)))
const ConcurrencyPercent = S.String.pipe(S.check(S.isPattern(/^(100|[1-9]?[0-9])%$/)))

const PLUGIN_ARBITRARY_SPECIFIERS: readonly [string, ...string[]] = [
  'file:///project/node_modules/@systemfsoftware/stryker-js-angular/index.mjs',
  'file:///home/user/project/plugins/custom-plugin.mjs',
  'effect',
  '@systemfsoftware/stryker-js-angular',
  '@systemfsoftware/stryker-js-svelte',
  'my-plugin',
  '@scope/my-plugin/sub/entry',
  'my-plugin/sub',
]

const pluginSpecifierArbitrary = S.link<string>()(S.Literals(PLUGIN_ARBITRARY_SPECIFIERS), {
  decode: SchemaGetter.transform((sample: string) => sample),
  encode: SchemaGetter.transform((sample: string) => sample),
})

export const PluginFileUrl = S.declare<string>(
  (value: unknown): value is string =>
    typeof value === 'string' &&
    /^(?:file:\/\/\/\S+|(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/(?!\.\.?\/)[^/\s]+)*)$/.test(value),
  {
    toCodecArbitrary: () => pluginSpecifierArbitrary,
  },
)

export const TestRunnerCustomConfigSchema = S.Struct({
  plugin: PluginFileUrl,
  nodeArgs: S.String.pipe(S.Array, S.optionalKey),
  options: S.optionalKey(S.Record(S.String, S.Unknown)),
})
export type TestRunnerCustomConfig = typeof TestRunnerCustomConfigSchema.Type

export const TestRunnerConfigSchema = S.Union([S.String, TestRunnerCustomConfigSchema])
export type TestRunnerConfig = typeof TestRunnerConfigSchema.Type

const AnyNonStringTestRunner = S.declare<TestRunnerCustomConfig>(
  (value): value is TestRunnerCustomConfig => typeof value !== 'string',
  { message: 'expected a custom test runner config' },
)

export const isCustomTestRunner = S.is(AnyNonStringTestRunner)

export const CheckerCustomConfigSchema = S.Struct({
  plugin: PluginFileUrl,
  nodeArgs: S.String.pipe(S.Array, S.optionalKey),
  options: S.optionalKey(S.Record(S.String, S.Unknown)),
})
export type CheckerCustomConfig = typeof CheckerCustomConfigSchema.Type

export const CheckerEntryConfigSchema = CheckerCustomConfigSchema
export type CheckerEntryConfig = typeof CheckerEntryConfigSchema.Type

// ---------------------------------------------------------------------------
// The option set
// ---------------------------------------------------------------------------

export const StrykerOptionsSchema = S.StructWithRest(
  S.Struct({
    allowConsoleColors: defaulted(S.Boolean, true),
    buildCommand: S.optionalKey(S.String),
    checkers: defaulted(S.Array(CheckerEntryConfigSchema), []),
    checkerNodeArgs: defaulted(S.Array(S.String), []),
    concurrency: S.optionalKey(S.Union([ConcurrencyCount, ConcurrencyPercent])),
    commandRunner: defaulted(CommandRunnerOptionsSchema, { command: 'npm test' }),
    coverageAnalysis: defaulted(CoverageAnalysisMode, StrykerCoverageAnalysis.literal),
    clearTextReporter: defaulted(ClearTextReporterOptions, {
      allowColor: true,
      allowEmojis: false,
      logTests: true,
      maxTestsToLog: 3,
      reportTests: true,
      reportMutants: true,
      reportScoreTable: true,
      skipFull: false,
    }),
    dryRunOnly: defaulted(S.Boolean, false),
    ignorePatterns: defaulted(S.Array(S.String), []),
    ignoreStatic: defaulted(S.Boolean, false),
    incremental: defaulted(S.Boolean, false),
    incrementalFile: defaulted(S.String, 'reports/stryker-incremental.json'),
    incrementalSources: defaulted(S.Array(S.String), []),
    progressStreamFile: defaulted(S.String, 'reports/mutation-stream.jsonl'),
    since: S.optionalKey(S.String),
    force: defaulted(S.Boolean, false),
    fileLogLevel: defaulted(LogLevel, StrykerFileLogLevel.literal),
    inPlace: defaulted(S.Boolean, false),
    logLevel: defaulted(LogLevel, StrykerLogLevel.literal),
    maxConcurrentTestRunners: defaulted(S.Int.pipe(S.check(S.isGreaterThanOrEqualTo(1))), Number.MAX_SAFE_INTEGER),
    maxTestRunnerReuse: defaulted(NonNegativeInt, 0),
    mutate: defaulted(S.Array(S.String), [
      '{src,lib}/**/!(*.+(s|S)pec|*.+(t|T)est).+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)',
      '!{src,lib}/**/__tests__/**/*.+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)',
    ]),
    mutator: defaulted(MutatorDescriptor, { excludedMutations: [], optInMutations: [], mutantSetPolicy: 'default' }),
    packageManager: S.optionalKey(PackageManager),
    plugins: defaulted(S.Array(PluginFileUrl), []),
    appendPlugins: defaulted(S.Array(PluginFileUrl), []),
    reporters: defaulted(S.Array(S.String), ['clear-text', 'progress', 'html']),
    htmlReporter: defaulted(HtmlReporterOptions, { fileName: 'reports/mutation/mutation.html' }),
    jsonReporter: defaulted(JsonReporterOptions, { fileName: 'reports/mutation/mutation.json' }),
    disableTypeChecks: defaulted(S.Union([S.Boolean, S.String]), true),
    symlinkNodeModules: defaulted(S.Boolean, true),
    tempDirName: defaulted(S.String, StrykerTempDirName.literal),
    cleanTempDir: defaulted(S.Literals(['always', false, true]), true),
    testRunner: defaulted(TestRunnerConfigSchema, 'vm'),
    testRunnerNodeArgs: defaulted(S.Array(S.String), []),
    thresholds: defaulted(MutationScoreThresholdsSchema, { high: 80, low: 60, break: null }),
    timeoutFactor: defaulted(NonNegativeFinite, 1.5),
    timeoutMS: defaulted(NonNegativeInt, 5000),
    dryRunTimeoutMinutes: defaulted(NonNegativeFinite, 5),
    tsconfigFile: defaulted(S.String, 'tsconfig.json'),
    warnings: defaulted(S.Union([S.Boolean, WarningOptions]), true),
    disableBail: defaulted(S.Boolean, false),
    allowEmpty: defaulted(S.Boolean, false),
    ignorers: defaulted(S.Array(PluginFileUrl), []),
    testFiles: defaulted(S.Array(S.String), []),
  }),
  [S.Record(S.String, S.Unknown)],
)

/** The decoded type: every defaulted option is present. */
export type StrykerOptions = S.Schema.Type<typeof StrykerOptionsSchema>

/**
 * The deep-partial input type: when configuring Stryker, every option is
 * optional, including deep properties like `dashboard.project`.
 */
export type PartialStrykerOptions = DeepOptional<StrykerOptions>

/**
 * Every option optional, all the way down, and mutable: this is the type a
 * caller CONSTRUCTS by assignment, so `readonly` is stripped. The decoded
 * `StrykerOptions` keeps it - that side is read, never built.
 */
export type DeepOptional<T, V = unknown> = {
  -readonly [P in keyof T]?: T[P] extends Record<string, V> ? DeepOptional<T[P], V> | undefined
    : T[P]
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Result = await import('effect/Result')

  const pairProbes: ReadonlyArray<readonly [number, number]> = [
    [80, 60],
    [60, 60],
    [80.5, 60.25],
    [60, 80],
    [101, 60],
    [-1, 0],
  ]

  it.prop(
    '∀p_ThresholdOrder_≡LowAtOrBelowHigh',
    { of: [S.Finite, S.Finite], subject: acceptsThresholdPair },
    (subject, [high, low]) =>
      Arr.every(
        pairProbes,
        ([probeHigh, probeLow]) => subject(probeHigh, probeLow) === isOrderedPercentagePair(probeHigh, probeLow),
      ) && subject(high, low) === isOrderedPercentagePair(high, low),
  )

  const policyProbes: ReadonlyArray<string> = [
    '',
    'default',
    'full',
    'DEFAULT',
    'defaults',
    'full ',
    ' default',
    'full\n',
    'full-set',
    'all',
  ]
  const withPolicyProbes = (drawn: string): ReadonlyArray<string> => Arr.prepend(policyProbes, drawn)

  const namesAPolicy = (value: string): boolean => value === 'default' || value === 'full'

  const namedOptionPath = (message: string): string | undefined => {
    const segments = Array.from(message.matchAll(/\["([^"]+)"\]/g), (matched) => String(matched[1]))
    return segments.length === 0 ? undefined : segments.join('.')
  }

  const decodeOutcome = (value: string): string | undefined =>
    Result.match(S.decodeUnknownResult(StrykerOptionsSchema)({ mutator: { mutantSetPolicy: value } }), {
      onFailure: (issue) => namedOptionPath(issue.message),
      onSuccess: (options) => options.mutator.mutantSetPolicy,
    })

  const policyOfOptions = (options: { readonly mutator?: { readonly mutantSetPolicy?: string } }): string | undefined =>
    Result.match(S.decodeUnknownResult(StrykerOptionsSchema)(options), {
      onFailure: () => undefined,
      onSuccess: (decoded) => decoded.mutator.mutantSetPolicy,
    })

  const accepts = {
    policy: decodeOutcome,
    policyWhenMutatorOmitted: (): string | undefined => policyOfOptions({}),
    policyWhenPolicyOmitted: (): string | undefined => policyOfOptions({ mutator: {} }),
  }

  const bothOmissionsDefault = (subject: typeof accepts): boolean =>
    subject.policyWhenMutatorOmitted() === 'default' && subject.policyWhenPolicyOmitted() === 'default'

  it.prop(
    '∀p_MutantSetPolicy_≡DecodedOrRefusedNamingItsOption',
    { of: [S.String], subject: accepts },
    (subject, [drawn]) =>
      Arr.every(
        withPolicyProbes(drawn),
        (value) => subject.policy(value) === (namesAPolicy(value) ? value : 'mutator.mutantSetPolicy'),
      ) && bothOmissionsDefault(subject),
  )
}
