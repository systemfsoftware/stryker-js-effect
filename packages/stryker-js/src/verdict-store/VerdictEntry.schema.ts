import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const VerdictKey = S.String.check(
  S.isPattern(/^[0-9a-f]{64}$/u, { expected: 'a 64-character lowercase hexadecimal verdict key' }),
).pipe(S.brand('VerdictKey'))
export type VerdictKey = typeof VerdictKey.Type

export const VerdictKindSchema = S.Literals(['tested', 'checker'])
export type VerdictKind = typeof VerdictKindSchema.Type

const sharedComponentFields = {
  engineDigest: S.String,
  runInputsDigest: S.String,
  mutantSetPolicy: Options.MutantSetPolicy,
  mutantId: Mutant.MutantId,
  fileName: S.String,
  mutatorName: S.String,
  replacementDigest: S.String,
  location: Mutant.Location,
  fileContentDigest: S.String,
}

export const TestedComponentsSchema = S.TaggedStruct('tested', {
  ...sharedComponentFields,
  coveringTestIds: S.Array(S.String),
  closureDigest: S.String,
  checkerConfigDigest: S.String,
})
export type TestedComponents = typeof TestedComponentsSchema.Type

export const CheckerComponentsSchema = S.TaggedStruct('checker', {
  ...sharedComponentFields,
  programDigest: S.String,
})
export type CheckerComponents = typeof CheckerComponentsSchema.Type

export const VerdictComponentsSchema = S.Union([TestedComponentsSchema, CheckerComponentsSchema])
export type VerdictComponents = typeof VerdictComponentsSchema.Type

export const TimeoutKindSchema = S.Literals(['wallClock', 'hitLimit'])
export type TimeoutKind = typeof TimeoutKindSchema.Type

const testedStatuses = ['Survived', 'Killed', 'Timeout', 'NoCoverage', 'Ignored'] as const satisfies ReadonlyArray<
  Mutant.RememberedStatus
>

export const TestedStatusSchema = S.Literals(testedStatuses)
export type TestedStatus = typeof TestedStatusSchema.Type

const measuredFields = {
  costMs: S.Finite.check(S.isGreaterThanOrEqualTo(0)),
  settledAt: S.Int.check(S.isGreaterThanOrEqualTo(0)),
}

export const TestedEntrySchema = S.Struct({
  components: TestedComponentsSchema,
  status: TestedStatusSchema,
  timeoutKind: S.optionalKey(TimeoutKindSchema),
  reproductions: S.optionalKey(S.Natural),
  testsCompleted: S.optionalKey(S.Finite),
  coveredBy: S.String.pipe(S.Array, S.optionalKey),
  killedBy: S.String.pipe(S.Array, S.optionalKey),
  ...measuredFields,
})
export type TestedEntry = typeof TestedEntrySchema.Type

export const CheckerEntrySchema = S.Struct({
  components: CheckerComponentsSchema,
  status: S.Literal('CompileError'),
  ...measuredFields,
})
export type CheckerEntry = typeof CheckerEntrySchema.Type

export const VerdictEntrySchema = S.Union([TestedEntrySchema, CheckerEntrySchema])
export type VerdictEntry = typeof VerdictEntrySchema.Type

export const VerdictEntryJson = S.fromJsonString(VerdictEntrySchema)

const accepts = {
  key: S.is(VerdictKey),
  entry: S.is(VerdictEntrySchema),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const hexDigits = '0123456789abcdef'
  const isFullDigest = (text: string): boolean =>
    text.length === 64 && Arr.every(Array.from(text), (char) => hexDigits.includes(char))
  const keySeeds = ['', 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'A'.repeat(64), `g${'0'.repeat(63)}`]

  it.prop(
    '∀s_VerdictKeyRefusal_≡FullLowercaseDigest',
    { of: [S.String], subject: accepts },
    (subject, [drawn]) => Arr.every(Arr.append(keySeeds, drawn), (text) => subject.key(text) === isFullDigest(text)),
  )

  const timeSeeds = [-1, 0, 1, Number.MAX_SAFE_INTEGER, 0.5]

  it.prop(
    '∀en_SettledAtRefusal_≡NonNegativeInteger',
    { of: [VerdictEntrySchema, S.Finite], subject: accepts },
    (subject, [entry, drawn]) =>
      Arr.every(
        Arr.append(timeSeeds, drawn),
        (settledAt) => subject.entry({ ...entry, settledAt }) === (Number.isSafeInteger(settledAt) && settledAt >= 0),
      ),
  )

  it.prop(
    '∀en_CostRefusal_≡NonNegative',
    { of: [VerdictEntrySchema, S.Finite], subject: accepts },
    (subject, [entry, drawn]) =>
      Arr.every(Arr.append(timeSeeds, drawn), (costMs) => subject.entry({ ...entry, costMs }) === costMs >= 0),
  )
}
