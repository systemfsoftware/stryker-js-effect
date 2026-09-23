import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { toRelativeNormalizedFileName } from './IncrementalDiff.paths.js'

export const MutantShape = S.Struct({
  id: S.String,
  fileName: S.String,
  mutatorName: S.String,
  replacement: S.String,
  location: S.Struct({
    start: S.Struct({ line: S.Finite, column: S.Finite }),
    end: S.Struct({ line: S.Finite, column: S.Finite }),
  }),
})

const SurvivorsAdmissionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SurvivorsAdmission')
type SurvivorsAdmissionTypeId = typeof SurvivorsAdmissionTypeId

export class PriorReportFacts extends S.Class<PriorReportFacts>('PriorReportFacts')({
  config: S.Record(S.String, S.Unknown),
  frameworkVersion: S.UndefinedOr(S.String),
}) {}

export class AdmitSurvivorsRunCommand extends S.Class<AdmitSurvivorsRunCommand>('AdmitSurvivorsRunCommand')({
  priorReport: S.UndefinedOr(PriorReportFacts),
  currentConfig: S.Record(S.String, S.Unknown),
  frameworkVersion: S.String,
  sourceContentHashes: S.Record(S.String, S.String),
  priorSourceHashes: S.Record(S.String, S.String),
  priorSurvivors: S.Array(MutantShape),
  basePath: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    frameworkVersion: 'stryker.survivors.framework_version',
  } as const
}

export class Admitted extends S.TaggedClass<Admitted>()('Admitted', {
  survivors: S.Array(MutantShape),
  mutateSpans: S.Array(S.String),
}) {
  readonly [SurvivorsAdmissionTypeId] = SurvivorsAdmissionTypeId
}

export class NoSurvivors extends S.TaggedClass<NoSurvivors>()('NoSurvivors', {}) {
  readonly [SurvivorsAdmissionTypeId] = SurvivorsAdmissionTypeId
}

export const SurvivorsAdmission = S.Union([Admitted, NoSurvivors])
export type SurvivorsAdmission = S.Schema.Type<typeof SurvivorsAdmission>

export class SurvivorsRejection extends S.TaggedError<SurvivorsRejection>()('SurvivorsRejection', {
  reason: S.Literals(['no-report', 'mismatch']),
  remediation: S.String,
}) {
  readonly [SurvivorsAdmissionTypeId] = SurvivorsAdmissionTypeId
}

const SURVIVORS_RUN_FIRST_REMEDIATION = 'run a full `stryker run` first, then re-run with --survivors'

const SURVIVORS_BOOKKEEPING_KEYS: readonly string[] = ['survivorsPriorReport']

const stripSurvivorsKeys = <A = unknown>(config: Record<string, A>): Record<string, A> =>
  Object.fromEntries(Object.entries(config).filter(([key]) => !SURVIVORS_BOOKKEEPING_KEYS.includes(key)))

const wasProducedBySurvivorsRun = <A = unknown>(priorReport: { readonly config: A }): boolean =>
  Option.exists(
    Option.liftPredicate(priorReport.config, Match.record),
    (config) => SURVIVORS_BOOKKEEPING_KEYS.some((bookkeeping) => bookkeeping in config),
  )

const hashValueSchema = (): S.Codec<S.Json> =>
  S.Union([
    S.Null,
    S.Finite,
    S.Boolean,
    S.String,
    S.Array(S.suspend(hashValueSchema)),
    S.Record(S.String, S.suspend(hashValueSchema)),
  ])

const SurvivorsHashInput = S.Struct({
  frameworkVersion: S.UndefinedOr(S.String),
  resolvedOptions: S.Record(S.String, S.UndefinedOr(S.suspend(hashValueSchema))),
  sourceContentHashes: S.Record(S.String, S.String),
})

const hashesEquivalent = S.toEquivalence(SurvivorsHashInput)

const decodeSurvivorsHashInput = <A = unknown>(input: {
  readonly resolvedOptions: Record<string, A>
  readonly frameworkVersion: string | undefined
  readonly sourceContentHashes: Readonly<Record<string, string>>
}) => S.decodeUnknownResult(SurvivorsHashInput)(input)

const NO_REPORT_DETAIL = 'No prior mutation report found — a --survivors run needs the report of a previous run.'
const SURVIVORS_RUN_SOURCE_DETAIL =
  'The prior mutation report was itself produced by a --survivors run, so it is not a valid input for another one.'
const MISMATCH_DETAIL =
  'The prior mutation report does not match the current run (resolved options, framework version, or source content differ).'

const hashesMatch = (priorReport: PriorReportFacts, input: AdmitSurvivorsRunCommand): boolean =>
  Result.match(
    decodeSurvivorsHashInput({
      resolvedOptions: stripSurvivorsKeys(priorReport.config),
      frameworkVersion: priorReport.frameworkVersion,
      sourceContentHashes: input.priorSourceHashes,
    }),
    {
      onFailure: () => false,
      onSuccess: (prior) =>
        Result.match(
          decodeSurvivorsHashInput({
            resolvedOptions: stripSurvivorsKeys(input.currentConfig),
            frameworkVersion: input.frameworkVersion,
            sourceContentHashes: input.sourceContentHashes,
          }),
          {
            onFailure: () => false,
            onSuccess: (current) => hashesEquivalent(prior, current),
          },
        ),
    },
  )

const PriorReportAbsentOutcome = S.TaggedStruct('PriorReportAbsent', {})
const PriorReportIsSurvivorsRunOutcome = S.TaggedStruct('PriorReportIsSurvivorsRun', {})
const NoSurvivorsFoundOutcome = S.TaggedStruct('NoSurvivorsFound', {})
const PriorReportDriftedOutcome = S.TaggedStruct('PriorReportDrifted', {})
const SurvivorsMatchOutcome = S.TaggedStruct('SurvivorsMatch', { survivors: S.Array(MutantShape) })

const AdmissionOutcome = S.Union([
  PriorReportAbsentOutcome,
  PriorReportIsSurvivorsRunOutcome,
  NoSurvivorsFoundOutcome,
  PriorReportDriftedOutcome,
  SurvivorsMatchOutcome,
])
type AdmissionOutcome = S.Schema.Type<typeof AdmissionOutcome>

const ADMISSION_RULES: readonly {
  readonly holds: (input: AdmitSurvivorsRunCommand) => boolean
  readonly outcome: AdmissionOutcome
}[] = [
  {
    holds: (input) => input.priorReport === undefined,
    outcome: PriorReportAbsentOutcome.make({}),
  },
  {
    holds: (input) => Option.exists(Option.fromUndefinedOr(input.priorReport), wasProducedBySurvivorsRun),
    outcome: PriorReportIsSurvivorsRunOutcome.make({}),
  },
  {
    holds: (input) => input.priorSurvivors.length === 0,
    outcome: NoSurvivorsFoundOutcome.make({}),
  },
  {
    holds: (input) => Option.exists(Option.fromUndefinedOr(input.priorReport), (facts) => !hashesMatch(facts, input)),
    outcome: PriorReportDriftedOutcome.make({}),
  },
]

const admissionOutcomeOf = (input: AdmitSurvivorsRunCommand): AdmissionOutcome =>
  Option.getOrElse(
    Option.map(Arr.findFirst(ADMISSION_RULES, (rule) => rule.holds(input)), (rule) => rule.outcome),
    (): AdmissionOutcome => SurvivorsMatchOutcome.make({ survivors: input.priorSurvivors }),
  )

const reject = (reason: 'no-report' | 'mismatch', detail: string) =>
  Result.fail(
    SurvivorsRejection.make({
      reason,
      remediation: `${detail} ${SURVIVORS_RUN_FIRST_REMEDIATION}`,
    }),
  )

const mutateSpansOf = (survivors: ReadonlyArray<S.Schema.Type<typeof MutantShape>>, basePath: string) => [
  ...new Set(
    survivors.map((survivor) =>
      `${toRelativeNormalizedFileName(survivor.fileName, basePath)}:${
        survivor.location.start.line + 1
      }:${survivor.location.start.column}-${survivor.location.end.line + 1}:${survivor.location.end.column}`
    ),
  ),
]

const decideAdmission = (
  input: AdmitSurvivorsRunCommand,
): Result.Result<SurvivorsAdmission, SurvivorsRejection> =>
  Match.value(admissionOutcomeOf(input)).pipe(
    Match.tag('PriorReportAbsent', () => reject('no-report', NO_REPORT_DETAIL)),
    Match.tag('PriorReportIsSurvivorsRun', () => reject('mismatch', SURVIVORS_RUN_SOURCE_DETAIL)),
    Match.tag('NoSurvivorsFound', () => Result.succeed(NoSurvivors.make())),
    Match.tag('PriorReportDrifted', () => reject('mismatch', MISMATCH_DETAIL)),
    Match.tag(
      'SurvivorsMatch',
      (matched) =>
        Result.succeed(
          Admitted.make({ survivors: matched.survivors, mutateSpans: mutateSpansOf(matched.survivors, input.basePath) }),
        ),
    ),
    Match.exhaustive,
  )

export const admitSurvivorsRun = Workflow.make({
  command: AdmitSurvivorsRunCommand,
  decision: SurvivorsAdmission,
  error: SurvivorsRejection,
  decide: decideAdmission,
})

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Mutant } = await import('@systemfsoftware/stryker-js-instrumenter')
  const Equivalence = await import('effect/Equivalence')
  const { Arbitrary } = await import('effect/unstable/arbitrary')
  const { survivorMutateSpans } = await import('./Survivors.js')

  const survivorsArb = Arbitrary.array(Arbitrary.schema(Mutant), { maxLength: 6 })

  it.prop(
    '∀survivors_basePath_DecisionMutateSpans_≡SurvivorSpansResidue',
    [survivorsArb, S.String.check(S.isMinLength(1), S.isMaxLength(8))],
    ([survivors, basePath]) =>
      Equivalence.Array(Equivalence.String)(
        mutateSpansOf(survivors, basePath),
        survivorMutateSpans(survivors, basePath),
      ),
  )
}
