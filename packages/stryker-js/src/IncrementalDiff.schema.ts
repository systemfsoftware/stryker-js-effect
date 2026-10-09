import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const FormatIdentitySchema = S.Struct({
  formatId: S.String,
  ownerModule: S.String,
  ownerVersion: S.String,
})

export type FormatIdentity = S.Schema.Type<typeof FormatIdentitySchema>

export const ReuseRefusalReasonSchema = S.Literals([
  'semanticsChanged',
  'policyChanged',
  'runInputsChanged',
  'closureChanged',
  'closureAnalysisFailed',
  'programChanged',
  'flakyDependency',
  'timeoutUnreproduced',
  'noPriorRecord',
])

export type ReuseRefusalReason = typeof ReuseRefusalReasonSchema.Type

export const ClosureDigestsSchema = S.Record(Mutant.MutantId, S.String)

export type ClosureDigests = S.Schema.Type<typeof ClosureDigestsSchema>

export const TimeoutKindSchema = S.Literals(['wallClock', 'hitLimit'])

export type TimeoutKind = typeof TimeoutKindSchema.Type

export const TimeoutEvidenceSchema = S.Struct({
  timeoutKind: TimeoutKindSchema,
  reproductions: S.Natural,
})

export type TimeoutEvidence = S.Schema.Type<typeof TimeoutEvidenceSchema>

export const PreviousReuseRecordSchema = S.Struct({
  mutantId: Mutant.MutantId,
  status: Mutant.MutantStatusSchema,
  statusReason: S.optional(S.String),
  closureDigest: S.optional(S.String),
  programDigest: S.optional(S.String),
  engineDigest: S.String,
  mutantSetPolicy: Options.MutantSetPolicy,
  runInputsDigest: S.String,
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
})

export type PreviousReuseRecord = S.Schema.Type<typeof PreviousReuseRecordSchema>

const reuseMutantFields = {
  id: Mutant.MutantId,
  closureDigest: S.optional(S.String),
  programDigest: S.optional(S.String),
  timeoutKind: S.optional(TimeoutKindSchema),
  reproductions: S.optional(S.Natural),
  testsCompleted: S.optional(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optional),
  killedBy: S.String.pipe(S.Array, S.optional),
  remembered: S.Boolean,
}

const ReuseMutantSchema = S.Union([
  S.Struct({
    ...reuseMutantFields,
    status: S.Literal('Ignored'),
    statusReason: Mutant.IgnoreStatusReasonText,
  }),
  S.Struct({
    ...reuseMutantFields,
    status: Mutant.SettledStatusSchema,
    statusReason: S.optional(S.String),
  }),
])

const ReuseFileSchema = S.Struct({
  mutants: S.Array(ReuseMutantSchema),
})

export const ReuseTestDefinitionSchema = S.Struct({
  id: S.String,
  name: S.String,
})

export const ReuseTestFileSchema = S.Struct({
  tests: S.Array(ReuseTestDefinitionSchema),
})

export type ReuseTestFile = typeof ReuseTestFileSchema.Type

export const ReuseTestFilesSchema = S.Record(S.String, ReuseTestFileSchema)

export type ReuseTestFiles = typeof ReuseTestFilesSchema.Type

export const ReuseReportSchema = S.Struct({
  engineDigest: S.String,
  mutantSetPolicy: Options.MutantSetPolicy,
  runInputsDigest: S.String,
  files: S.Record(S.String, ReuseFileSchema),
  testFiles: S.optional(ReuseTestFilesSchema),
})

export type ReuseReport = S.Schema.Type<typeof ReuseReportSchema>

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Result = await import('effect/Result')

  const reasonSeeds: ReadonlyArray<string | undefined> = [
    undefined,
    '',
    'Remembered',
    'arid-logging',
    'arid-logging:',
    'arid-logging: Effect.logInfo',
    'made-up-rule: x',
    'wall-clock-timeout',
  ]

  const recordLineOf = (status: Mutant.MutantStatus, statusReason: string | undefined) => ({
    id: '0000000000000001',
    status,
    remembered: false,
    ...(statusReason === undefined ? {} : { statusReason }),
  })

  const decodesRecordLine = (status: Mutant.MutantStatus, statusReason: string | undefined): boolean =>
    Result.isSuccess(S.decodeUnknownResult(ReuseMutantSchema)(recordLineOf(status, statusReason)))

  const namesAnIgnoreRule = (reason: string | undefined): boolean =>
    reason !== undefined && Mutant.IgnoreRuleId.literals.some((ruleId) => reason.startsWith(`${ruleId}: `))

  it.prop(
    '∀sr_RecordLineRefusal_≡IgnoredOnlyWithAnIgnoreRuleReason',
    { of: [Mutant.MutantStatusSchema, S.UndefinedOr(S.String)], subject: decodesRecordLine },
    (subject, [status, drawn]) =>
      Arr.every(
        Arr.prepend(reasonSeeds, drawn),
        (reason) => subject(status, reason) === (status !== 'Ignored' || namesAnIgnoreRule(reason)),
      ),
  )
}
