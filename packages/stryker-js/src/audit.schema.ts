import { Mutant, Options, type Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaIssue from 'effect/SchemaIssue'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const AuditSchemaVersion = S.Literal('1')

const Count = S.Int.check(S.isGreaterThanOrEqualTo(0))

const STRING_TOKEN = /("(?:[^"\\]|\\[\s\S])*")(\s*:)?/g

const decodeJsonObject = S.decodeUnknownEffect(S.fromJsonString(S.JsonObject))

const decodeJsonString = S.decodeUnknownEffect(S.fromJsonString(S.String))

const isJsonArray = (value: S.Json): value is ReadonlyArray<S.Json> => Arr.isArray(value)

const isJsonObject = (value: S.Json): value is S.JsonObject => Match.record(value)

const keyAtOffset = (
  keyAt: Record.ReadonlyRecord<string, string>,
  offset: string,
): Effect.Effect<string, S.SchemaError> =>
  Effect.fromOption(
    Record.get(keyAt, offset),
    () => new S.SchemaError(new SchemaIssue.InvalidValue({ message: `no key token at offset ${offset}` })),
  )

const rekeyedBy = (keyAt: Record.ReadonlyRecord<string, string>) => {
  const rekeyedObject = (object: S.JsonObject): Effect.Effect<S.JsonObject, S.SchemaError> =>
    Effect.map(
      Effect.forEach(Object.entries(object), ([offset, member]) =>
        Effect.zip(keyAtOffset(keyAt, offset), rekeyed(member))),
      Record.fromEntries,
    )
  const rekeyed = (value: S.Json): Effect.Effect<S.Json, S.SchemaError> =>
    Match.value(value).pipe(
      Match.when(isJsonArray, (items) => Effect.forEach(items, rekeyed)),
      Match.when(isJsonObject, rekeyedObject),
      Match.orElse((leaf) => Effect.succeed(leaf)),
    )
  return rekeyedObject
}

interface KeyToken {
  readonly offset: number
  readonly literal: string
}

const keyTokensOf = (text: string): ReadonlyArray<KeyToken> =>
  Arr.flatMap(
    Arr.fromIterable(text.matchAll(STRING_TOKEN)),
    (token) =>
      Option.match(Option.all([Option.fromUndefinedOr(token[1]), Option.fromUndefinedOr(token[2])]), {
        onNone: (): ReadonlyArray<KeyToken> => [],
        onSome: ([literal]) => [{ offset: token.index, literal }],
      }),
  )

const placeheld = (text: string): string =>
  text.replace(
    STRING_TOKEN,
    (token: string, _literal: string, colon: string | undefined, offset: number) =>
      Option.match(Option.fromUndefinedOr(colon), {
        onNone: () => token,
        onSome: (separator) => `"${offset}"${separator}`,
      }),
  )

const decodeJsonPastNodejs63785 = (text: string) =>
  Effect.gen(function*() {
    yield* decodeJsonObject(text)
    const tokens = keyTokensOf(text)
    const keys = yield* Effect.forEach(tokens, (token) => decodeJsonString(token.literal))
    const keyAt = Record.fromEntries(Arr.zip(tokens.map((token) => `${token.offset}`), keys))
    return yield* rekeyedBy(keyAt)(yield* decodeJsonObject(placeheld(text)))
  })

const exactKeyJson = {
  decode: SchemaGetter.transformEffect((text: string) =>
    Effect.mapError(decodeJsonPastNodejs63785(text), (error) => error.issue)
  ),
  encode: SchemaGetter.stringifyJson(),
}

const JSON_TEXT = { expected: 'a string that will be decoded as JSON', contentMediaType: 'application/json' }

const isFilePath = (key: string): boolean => key.length > 0 && !key.includes('\u0000')

const keyedByFilePath = S.makeFilter((files: { readonly [key: string]: object }) =>
  Arr.filter(Object.keys(files), (key) => !isFilePath(key)).map((key) => ({
    path: [key],
    issue: 'Expected a non-empty file path without NUL',
  }))
)

export const KillMatrixReport = S.Struct({
  projectRoot: S.String,
  mutantSetPolicy: Options.MutantSetPolicy,
  files: S.Record(
    S.String,
    S.Struct({
      source: S.String,
      mutants: S.Array(S.Struct({
        id: S.String,
        status: Mutant.MutantStatusSchema,
        killedBy: S.String.pipe(S.Array, S.optionalKey),
      })),
    }),
  ).check(keyedByFilePath),
  testFiles: S.Record(S.String, S.Struct({ tests: S.Array(S.Struct({ id: S.String })) })),
})
export type KillMatrixReport = typeof KillMatrixReport.Type
export const KillMatrixReportJson = S.String.annotate(JSON_TEXT).pipe(
  S.decodeTo(S.Unknown, exactKeyJson),
  S.decodeTo(KillMatrixReport, SchemaTransformation.passthrough({ strict: false })),
)

export const CountedReport = S.Struct({
  files: S.Record(
    S.String,
    S.Struct({
      mutants: S.Array(S.Struct({
        id: S.String,
        status: Mutant.MutantStatusSchema,
        statusReason: S.String.pipe(S.optionalKey),
        testsCompleted: Count.pipe(S.optionalKey),
      })),
    }),
  ).check(keyedByFilePath),
  costs: S.Record(S.String, S.Struct({ actualMs: S.NullOr(S.Finite) })).pipe(S.optionalKey),
})
export type CountedReport = typeof CountedReport.Type
export const CountedReportJson = S.String.annotate(JSON_TEXT).pipe(
  S.decodeTo(S.Unknown, exactKeyJson),
  S.decodeTo(CountedReport, SchemaTransformation.passthrough({ strict: false })),
)

export const AuditScope = S.Union([
  S.TaggedStruct('Corpus', {}),
  S.TaggedStruct('Files', { files: S.NonEmptyArray(S.String) }),
])
export type AuditScope = typeof AuditScope.Type

export const PassReason = S.Literals(['killers-contained', 'dropped-mutant-carries-no-kill-signal'])
export const VacuousReason = S.Literals(['dominator-survived', 'dominator-uncovered'])
export const UnverifiedReason = S.Literals([
  'killer-is-file-hook',
  'killer-unrecorded',
  'dropped-mutant-timed-out',
  'dominator-timed-out',
])
export const FailReason = S.Literals([
  'killers-not-contained',
  'dropped-mutant-survives',
  'misidentified-pair',
  'dominator-not-run',
])
export const UnjoinableReason = S.Literals(['mutant-absent', 'dominator-absent', 'status-unsettled'])

export const PairVerdict = S.Union([
  S.TaggedStruct('Pass', { reason: PassReason }),
  S.TaggedStruct('Vacuous', { reason: VacuousReason }),
  S.TaggedStruct('AttributionUnverified', { reason: UnverifiedReason }),
  S.TaggedStruct('Fail', { reason: FailReason }),
])
export type PairVerdict = typeof PairVerdict.Type

const PairFields = {
  project: S.String,
  rule: Mutant.Subsumed.fields.rule,
  mutant: Mutant.MutantId,
  dominator: Mutant.MutantId,
  next: S.String,
}

const JoinedPair = S.TaggedStruct('JoinedPair', {
  ...PairFields,
  mutantStatus: Mutant.MutantStatusSchema,
  dominatorStatus: Mutant.MutantStatusSchema,
  missingKillers: S.Array(S.String),
  verdict: PairVerdict,
})

const UnjoinablePair = S.TaggedStruct('UnjoinablePair', {
  ...PairFields,
  reason: UnjoinableReason,
})

export const AuditedPair = S.Union([JoinedPair, UnjoinablePair])
export type AuditedPair = typeof AuditedPair.Type

const RuleCounts = {
  rule: Mutant.Subsumed.fields.rule,
  drops: Count,
  pass: Count,
  vacuous: Count,
  attributionUnverified: Count,
  fail: Count,
  unjoinable: Count,
}

export const RuleSummary = S.Union([
  S.TaggedStruct('Attested', RuleCounts),
  S.TaggedStruct('Unattested', { ...RuleCounts, reason: S.Literal('no-drop-joined'), next: S.String }),
])
export type RuleSummary = typeof RuleSummary.Type

export const OrphanedTest = S.Struct({
  project: S.String,
  test: S.String,
  killed: S.NonEmptyArray(S.String),
  reason: S.Literal('every-killed-mutant-dropped'),
  next: S.String,
})
export type OrphanedTest = typeof OrphanedTest.Type

const ProjectDrops = S.Struct({
  project: S.String,
  matrixMutants: Count,
  drops: Count,
})

const DropAuditFields = {
  schemaVersion: AuditSchemaVersion,
  scope: AuditScope,
  projects: S.Array(ProjectDrops),
  rules: S.Array(RuleSummary),
  pairs: S.Array(AuditedPair),
  orphanedTests: S.Array(OrphanedTest),
}

const AuditFailures = S.Struct({ pairs: Count, unattestedRules: Count, orphanedTests: Count })

const AuditReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/AuditReport')

export class DropAuditPassed extends S.TaggedClass<DropAuditPassed>()('DropAuditPassed', DropAuditFields) {
  readonly [AuditReportTypeId] = AuditReportTypeId
}

export class DropAuditFailed extends S.TaggedClass<DropAuditFailed>()('DropAuditFailed', {
  ...DropAuditFields,
  failures: AuditFailures,
}) {
  readonly [AuditReportTypeId] = AuditReportTypeId
}

export const DropAuditReport = S.Union([DropAuditPassed, DropAuditFailed])
export type DropAuditReport = typeof DropAuditReport.Type

export const MatrixMutant = S.Struct({
  id: S.String,
  status: Mutant.MutantStatusSchema,
  killedBy: S.Array(S.String),
})
export type MatrixMutant = typeof MatrixMutant.Type

export const MatrixProject = S.Struct({
  project: S.String,
  mutants: S.Array(MatrixMutant),
  tests: S.Array(S.String),
})
export type MatrixProject = typeof MatrixProject.Type

export const AuditedDrop = S.Struct({
  project: S.String,
  mutant: Mutant.MutantId,
  subsumed: Mutant.Subsumed,
})
export type AuditedDrop = typeof AuditedDrop.Type

export const StatusCounts = S.Struct({
  Killed: Count,
  Survived: Count,
  NoCoverage: Count,
  CompileError: Count,
  RuntimeError: Count,
  Timeout: Count,
  Ignored: Count,
  Pending: Count,
})
export type StatusCounts = typeof StatusCounts.Type

export const RunCounts = S.Struct({
  planned: Count,
  statuses: StatusCounts,
  ignoredByRule: S.Array(S.Struct({ rule: Mutant.IgnoreRuleId, count: Count })),
  ignoredUnrecognized: Count,
  compileErrorShare: S.Finite,
  compiled: Count,
  executed: Count,
  testExecutions: Count,
  compileErrorCheckerMs: S.Finite,
})
export type RunCounts = typeof RunCounts.Type

export class CountsReport extends S.TaggedClass<CountsReport>()('Counts', {
  schemaVersion: AuditSchemaVersion,
  projects: S.Array(S.Struct({ project: S.String, counts: RunCounts })),
  total: RunCounts,
}) {
  readonly [AuditReportTypeId] = AuditReportTypeId
}

export const AuditReport = S.Union([DropAuditPassed, DropAuditFailed, CountsReport])
export type AuditReport = typeof AuditReport.Type
export const AuditReportJson = S.fromJsonString(AuditReport)

export const CountedProject = S.Struct({ project: S.String, report: CountedReport })

export class NothingCounted extends S.TaggedError<NothingCounted>()('NothingCounted', {
  projects: S.Array(S.String),
}) {
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass
  readonly code = 'no-mutant-recorded' as const

  get reason(): string {
    return [
      `stryker audit (${this.code}): the incremental reports of ${this.projects.join(', ')} record no mutant.`,
      "Pass --matrix the directory of a finished run's reports and --projects the directories it ran.",
    ].join(' ')
  }

  override get message(): string {
    return this.reason
  }
}

export class AuditFailed extends S.TaggedError<AuditFailed>()('AuditFailed', {
  failures: AuditFailures,
  report: S.String,
}) {
  readonly exitClass = 'VerdictFail' satisfies Plugin.ExitClass

  override get message(): string {
    return [
      `stryker audit: dropping these mutants loses kill signal: ${this.failures.pairs} failed pair(s),`,
      `${this.failures.unattestedRules} unattested rule(s), ${this.failures.orphanedTests} orphaned test(s).`,
      `Each entry in ${this.report} carries its reason code and next action.`,
    ].join(' ')
  }
}

const AuditInputCode = S.Literals([
  'matrix-unreadable',
  'matrix-undecodable',
  'matrix-not-full',
  'files-outside-matrix',
  'files-with-counts-only',
])

export class AuditInputUnusable extends S.TaggedError<AuditInputUnusable>()('AuditInputUnusable', {
  code: AuditInputCode,
  detail: S.String,
  next: S.String,
}) {
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass

  get reason(): string {
    return `stryker audit (${this.code}): ${this.detail}. ${this.next}`
  }

  override get message(): string {
    return this.reason
  }
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Result = await import('effect/Result')

  const boundaries: ReadonlyArray<number> = [
    -1,
    -0,
    0,
    0.5,
    1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Infinity,
    -Infinity,
  ]

  const decodesCount = (value: number): boolean => Result.isSuccess(S.decodeResult(Count)(value))

  it.prop(
    '∀n_CountRefusal_≡AcceptsExactlyTheNonNegativeSafeIntegers',
    { of: [S.Finite], subject: decodesCount },
    (subject, [drawn]) =>
      Arr.every(
        Arr.prepend(boundaries, drawn),
        (value) => subject(value) === (Number.isSafeInteger(value) && value >= 0),
      ),
  )

  const KeyPrefix = S.String.check(S.isPattern(/^[^\0]*$/u))
  const EscapedCharacter = S.Literals(['\u0001', '\b', '\t', '\n', '\f', '\r', '\u001b', '\u001f', '"'])
  const twinBoundaries: ReadonlyArray<readonly [string, string]> = [['', '\u0001'], ['src/weird', '\t']]
  const sameKeys = Arr.makeEquivalence<string>((left, right) => left === right)

  const filesOf = <A>(keys: ReadonlyArray<string>, file: A): Record.ReadonlyRecord<string, A> =>
    Record.fromEntries(keys.map((key) => [key, file]))

  const keysReadBack = (keys: ReadonlyArray<string>): ReadonlyArray<Option.Option<ReadonlyArray<string>>> => [
    Option.map(
      S.decodeOption(CountedReportJson)(JSON.stringify({ files: filesOf(keys, { mutants: [] }) })),
      (report) => Object.keys(report.files),
    ),
    Option.map(
      S.decodeOption(KillMatrixReportJson)(JSON.stringify({
        projectRoot: '',
        mutantSetPolicy: 'full',
        files: filesOf(keys, { source: '', mutants: [] }),
        testFiles: {},
      })),
      (report) => Object.keys(report.files),
    ),
  ]

  const filePathBoundaries: ReadonlyArray<string> = ['', '\u0000', 'a\u0000', 'src/a\u0000.ts', '\t', '\\', 'src/a.ts']

  const sameRead = Option.makeEquivalence(sameKeys)

  const namesAFile = (key: string): boolean => key !== '' && key.indexOf('\u0000') === -1

  const keysEncoded = (key: string): ReadonlyArray<boolean> => [
    Option.isSome(S.encodeOption(CountedReportJson)({ files: filesOf([key], { mutants: [] }) })),
    Option.isSome(
      S.encodeOption(KillMatrixReportJson)({
        projectRoot: '',
        mutantSetPolicy: 'full',
        files: filesOf([key], { source: '', mutants: [] }),
        testFiles: {},
      }),
    ),
  ]

  it.prop(
    '∀k_ReportFilePathRefusal_≡BothReportsKeepExactlyTheNonEmptyKeysWithoutNul',
    { of: [S.String], subject: (key: string) => ({ reads: keysReadBack([key]), encoded: keysEncoded(key) }) },
    (subject, [drawn]) =>
      Arr.every(Arr.prepend(filePathBoundaries, drawn), (key) => {
        const { reads, encoded } = subject(key)
        return Arr.every(reads, (read) => sameRead(read, Option.filter(Option.some([key]), () => namesAFile(key)))) &&
          Arr.every(encoded, (isEncoded) => isEncoded === namesAFile(key))
      }),
  )

  const leadOf = (prefix: string): string => `nodejs-63785/${prefix}`

  const keysReadAfterTwin = (prefix: string, escaped: string): ReadonlyArray<Option.Option<ReadonlyArray<string>>> => {
    JSON.parse(JSON.stringify(filesOf([leadOf(prefix), `${prefix}\\`], 0)))
    return keysReadBack([leadOf(prefix), `${prefix}${escaped}`])
  }

  it.prop(
    '∀p_ReportJsonKeys_≡ReadAnEscapedKeyExactlyAfterAParseOfItsBackslashTwin',
    { of: [KeyPrefix, EscapedCharacter], subject: keysReadAfterTwin },
    (subject, [prefix, escaped]) =>
      Arr.every(Arr.prepend(twinBoundaries, [prefix, escaped] as const), ([p, e]) =>
        Arr.every(
          subject(p, e),
          (read) => Option.exists(read, (keys) => sameKeys(keys, [leadOf(p), `${p}${e}`])),
        )),
  )
}
