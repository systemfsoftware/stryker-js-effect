import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { FailureCatalog } from './failure-catalog.js'
import {
  type Capsule,
  type CauseLink,
  type FailedTestEvidence,
  type FailureCode,
  FailureRecord,
  type NextAction,
  type PluginLoadRefusal,
  type Replays,
} from './failure-record.schema.js'

const meaningOf = (code: FailureCode): string => FailureCatalog[code].meaning

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/u

const singleQuoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const isShellSafe = (value: string): boolean => value.length > 0 && SHELL_SAFE.test(value)

const shellQuote = (value: string): string => (isShellSafe(value) ? value : singleQuoted(value))

const escapeCommandData = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

const escapeCommandProperty = (value: string): string =>
  escapeCommandData(value).replaceAll(':', '%3A').replaceAll(',', '%2C')

const indentLines = (text: string, prefix: string): ReadonlyArray<string> =>
  text.split('\n').map((line) => `${prefix}${line}`)

const locationTextOf = (location: { readonly file: string; readonly line: number; readonly column: number }): string =>
  `${location.file}:${location.line}:${location.column}`

const textOrFallback = (value: string | null, fallback: string): string => (value === null ? fallback : value)

const numberOrFallback = (value: number | null, fallback: string): string => value === null ? fallback : `${value}`

const refusalTextOf = (refusal: PluginLoadRefusal): string =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      PeerMissing: (missing) => `the peer ${missing.peer} is not installed`,
      PeerVersionUnsupported: (unsupported) =>
        `the peer ${unsupported.peer} is at an unsupported version: ${unsupported.detail}`,
      PeerUnrecognized: (unrecognized) => `the peer ${unrecognized.peer} is not recognized`,
      InvalidContribution: (invalid) => `its contribution is invalid: ${invalid.detail}`,
    }),
  )

const nonNullPrefixOf = (value: string | null): string => (value === null ? '' : `${value} `)

const failedTestWhereOf = (test: FailedTestEvidence): string =>
  test.location === null ? nonNullPrefixOf(test.file) : `${locationTextOf(test.location)} `

const failedTestHeadingOf = (test: FailedTestEvidence): string => `${failedTestWhereOf(test)}${test.name}`

const unlocatedStackOf = (test: FailedTestEvidence): string | null => (test.location === null ? test.stack : null)

const baselineTestLinesOf = (
  testCount: number,
  tests: ReadonlyArray<FailedTestEvidence>,
): ReadonlyArray<string> => [
  `${tests.length} of ${testCount} test(s) failed`,
  ...Arr.flatMap(tests, (test) => [
    `- ${failedTestHeadingOf(test)}`,
    `  message: ${test.message}`,
    ...Option.match(Option.fromNullishOr(unlocatedStackOf(test)), {
      onNone: (): ReadonlyArray<string> => [],
      onSome: (stack) => ['  stack:', ...indentLines(stack, '    ')],
    }),
  ]),
]

const evidenceLinesOf = (record: FailureRecord): ReadonlyArray<string> =>
  Match.value(record).pipe(
    Match.tagsExhaustive({
      ArgumentsInvalid: (evidence) =>
        evidence.argument === null ? ['no argument was named'] : [`argument: ${evidence.argument}`],
      ConfigInvalid: (evidence) => [`detail: ${evidence.detail}`],
      PluginNotFound: (evidence) => [`descriptor: ${evidence.descriptor}`],
      PluginLoadFailed: (evidence) => [
        `descriptor: ${evidence.descriptor}`,
        `refusal: ${refusalTextOf(evidence.reason)}`,
      ],
      PluginImportFailed: (evidence) => [`descriptor: ${evidence.descriptor}`],
      SurvivorsUnavailable: (evidence) => [`reason: ${evidence.reason}`],
      NoInputFiles: () => [],
      SandboxPreparationFailed: () => [],
      InstrumentationFailed: () => [],
      CheckerFailed: (evidence) => [`checker: ${textOrFallback(evidence.checker, '(not named)')}`],
      TestRunnerFailed: () => [],
      BaselineTestsFailed: (evidence) => baselineTestLinesOf(evidence.testCount, evidence.tests),
      BaselineTimedOut: () => [],
      BaselineErrored: () => [],
      BaselineFoundNoTests: () => [],
      WorkerBootTimedOut: (evidence) => [
        `worker: ${evidence.workerKind} pid ${evidence.pid}`,
        'its boot window closed before it reported ready',
      ],
      WorkerOutOfMemory: (evidence) => [
        `worker: ${evidence.workerKind} pid ${evidence.pid}`,
        `exit code: ${evidence.exitCode}`,
      ],
      WorkerCrashed: (evidence) => [
        `worker: ${evidence.workerKind} pid ${evidence.pid}`,
        `exit code: ${numberOrFallback(evidence.exitCode, '(no exit code)')}`,
        `signal: ${textOrFallback(evidence.signal, '(no signal)')}`,
      ],
      ReporterFailed: (evidence) => [`reporter: ${textOrFallback(evidence.reporter, '(not named)')}`],
      RunInterrupted: () => [],
      NewSurvivors: (evidence) => [
        `survivors: ${evidence.survivors.length} listed, ${evidence.unchecked} unchecked`,
        ...evidence.survivors.map((survivor) => `${survivor.file}:${survivor.line} ${survivor.mutantId}`),
      ],
      InvariantBroken: () => [],
      CatalogGap: () => [],
      RecordMissing: (evidence) => [`exit code: ${numberOrFallback(evidence.exitCode, '(not recorded)')}`],
      JobTimedOut: (evidence) => [`time limit: ${evidence.limitSeconds}s`],
      BinaryMissing: (evidence) => [`binary: ${evidence.binary}`],
    }),
  )

const stackShownFor = (record: FailureRecord) => (link: CauseLink): string | null =>
  Predicate.isTagged(record, 'CatalogGap') ? link.stack : null

const causeLinesOf = (record: FailureRecord): ReadonlyArray<string> =>
  Arr.flatMap(record.cause, (link) => [
    `${link.kind}: ${link.message}`,
    ...Option.match(Option.fromNullishOr(stackShownFor(record)(link)), {
      onNone: (): ReadonlyArray<string> => [],
      onSome: (stack) => indentLines(stack, '  '),
    }),
  ])

const reproduceCommandOf = (replays: Replays): string =>
  `(cd ${shellQuote(replays.cwd)} && ${
    [
      ...replays.env.map((entry) => `${entry.name}=${shellQuote(entry.value)}`),
      ...replays.argv.map(shellQuote),
    ].join(' ')
  })`

const capsuleLinesOf = (capsule: Capsule): ReadonlyArray<string> =>
  Match.value(capsule).pipe(
    Match.tagsExhaustive({
      Replays: (replays) => [`reproduce: ${reproduceCommandOf(replays)}`],
      DoesNotReplay: (refusal) => [`does not replay (${refusal.why}); instead: ${refusal.standIn}`],
    }),
  )

const otherwiseLinesOf = (record: FailureRecord): ReadonlyArray<string> =>
  record.nextAction.otherwise === null ? [] : [`otherwise: ${record.nextAction.otherwise}`]

const traceLinesOf = (record: FailureRecord): ReadonlyArray<string> =>
  record.traceId === null ? [] : [`trace: ${record.traceId}`]

export const terminalTextOf = (record: FailureRecord): string =>
  [
    `${record._tag}: ${meaningOf(record._tag)}`,
    ...evidenceLinesOf(record),
    ...causeLinesOf(record),
    `next: ${record.nextAction.primary}`,
    ...otherwiseLinesOf(record),
    ...capsuleLinesOf(record.capsule),
    ...traceLinesOf(record),
  ].join('\n')

const isBulletLine = (line: string): boolean => line.startsWith('- ')

const indentedBulletOf = (line: string): string => (line.startsWith(' ') ? `  - ${line.trimStart()}` : `- ${line}`)

const markdownBulletOf = (line: string): string => (isBulletLine(line) ? line : indentedBulletOf(line))

const otherwiseSuffixOf = (nextAction: NextAction): string =>
  nextAction.otherwise === null ? '' : ` (otherwise \`${nextAction.otherwise}\`)`

const bulletsOf = (facts: ReadonlyArray<string>): ReadonlyArray<string> =>
  facts.length === 0 ? ['- no further evidence'] : facts.map(markdownBulletOf)

const markdownCapsuleLinesOf = (capsule: Capsule, traceId: string | null): ReadonlyArray<string> => [
  ...Match.value(capsule).pipe(
    Match.tagsExhaustive({
      Replays: (replays) => ['**Replay:**', '', '```bash', reproduceCommandOf(replays), '```'],
      DoesNotReplay: (refusal) => [`**Replay:** does not replay (${refusal.why}); instead: ${refusal.standIn}`],
    }),
  ),
  ...(traceId === null ? [] : ['', `**Trace:** \`${traceId}\``]),
]

export const markdownOf = (record: FailureRecord): string => {
  const facts = [...evidenceLinesOf(record), ...causeLinesOf(record)]
  return [
    `## \`${record._tag}\`: ${meaningOf(record._tag)}`,
    '',
    ...bulletsOf(facts),
    '',
    `**Next:** \`${record.nextAction.primary}\`${otherwiseSuffixOf(record.nextAction)}`,
    '',
    ...markdownCapsuleLinesOf(record.capsule, record.traceId),
    '',
  ].join('\n')
}

interface LocatedEvidence {
  readonly file: string
  readonly line: number
  readonly column: number | null
  readonly message: string
}

const locatedEvidenceOf = (record: FailureRecord): ReadonlyArray<LocatedEvidence> =>
  Match.value(record).pipe(
    Match.tagsExhaustive({
      BaselineTestsFailed: (evidence) =>
        Arr.flatMap(evidence.tests, (test) =>
          test.location === null
            ? []
            : [
              {
                file: test.location.file,
                line: test.location.line,
                column: test.location.column,
                message: `${test.name}: ${test.message}`,
              },
            ]),
      NewSurvivors: (evidence) =>
        evidence.survivors.map((survivor) => ({
          file: survivor.file,
          line: survivor.line,
          column: null,
          message: `surviving mutant ${survivor.mutantId}`,
        })),
      ArgumentsInvalid: () => [],
      ConfigInvalid: () => [],
      PluginNotFound: () => [],
      PluginLoadFailed: () => [],
      PluginImportFailed: () => [],
      SurvivorsUnavailable: () => [],
      NoInputFiles: () => [],
      SandboxPreparationFailed: () => [],
      InstrumentationFailed: () => [],
      CheckerFailed: () => [],
      TestRunnerFailed: () => [],
      BaselineTimedOut: () => [],
      BaselineErrored: () => [],
      BaselineFoundNoTests: () => [],
      WorkerBootTimedOut: () => [],
      WorkerOutOfMemory: () => [],
      WorkerCrashed: () => [],
      ReporterFailed: () => [],
      RunInterrupted: () => [],
      InvariantBroken: () => [],
      CatalogGap: () => [],
      RecordMissing: () => [],
      JobTimedOut: () => [],
      BinaryMissing: () => [],
    }),
  )

const annotationOf = (code: FailureCode, located: LocatedEvidence): string => {
  const properties = [
    `title=${escapeCommandProperty(code)}`,
    `file=${escapeCommandProperty(located.file)}`,
    `line=${escapeCommandProperty(`${located.line}`)}`,
    ...(located.column === null ? [] : [`col=${escapeCommandProperty(`${located.column}`)}`]),
  ].join(',')
  return `::error ${properties}::${escapeCommandData(located.message)}`
}

const firstEvidenceLineOf = (record: FailureRecord): Option.Option<string> => Arr.head(evidenceLinesOf(record))

const summaryAnnotationOf = (record: FailureRecord): string => {
  const summary = Option.match(firstEvidenceLineOf(record), {
    onNone: () => meaningOf(record._tag),
    onSome: (first) => `${meaningOf(record._tag)} — ${first}`,
  })
  return `::error title=${escapeCommandProperty(record._tag)}::${escapeCommandData(summary)}`
}

export const annotationsOf = (record: FailureRecord): ReadonlyArray<string> => {
  const located = locatedEvidenceOf(record)
  return located.length === 0
    ? [summaryAnnotationOf(record)]
    : located.map((entry) => annotationOf(record._tag, entry))
}

export const sarifTextOf = (record: FailureRecord): string =>
  [
    `${record._tag}: ${meaningOf(record._tag)}`,
    ...Option.toArray(firstEvidenceLineOf(record)),
    `next: ${record.nextAction.primary}`,
  ].join(' — ')

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const FORBIDDEN = /\[object Object\]|Unknown failure|_tag|~(?:stryker|systemfsoftware|effect)\b/u
  const LINE_BREAK = /[\r\n]/u
  const JOIN = '\u0000'

  const locatedAnnotationTextOf = (
    code: FailureCode,
    file: string,
    line: number,
    column: number | null,
    message: string,
  ): string =>
    `::error title=${escapeCommandProperty(code)},file=${escapeCommandProperty(file)},` +
    `line=${escapeCommandProperty(`${line}`)}` +
    `${column === null ? '' : `,col=${escapeCommandProperty(`${column}`)}`}::${escapeCommandData(message)}`

  const expectedAnnotationsOf = (record: FailureRecord): ReadonlyArray<string> =>
    Match.value(record).pipe(
      Match.tag('BaselineTestsFailed', (evidence) =>
        Arr.flatMap(evidence.tests, (test) =>
          test.location === null
            ? []
            : [
              locatedAnnotationTextOf(
                'BaselineTestsFailed',
                test.location.file,
                test.location.line,
                test.location.column,
                `${test.name}: ${test.message}`,
              ),
            ])),
      Match.tag('NewSurvivors', (evidence) =>
        evidence.survivors.map((survivor) =>
          locatedAnnotationTextOf(
            'NewSurvivors',
            survivor.file,
            survivor.line,
            null,
            `surviving mutant ${survivor.mutantId}`,
          )
        )),
      Match.orElse((): ReadonlyArray<string> => []),
    )

  const summaryOnly = (annotations: ReadonlyArray<string>, code: FailureCode): boolean =>
    annotations.length === 1 && Arr.every(annotations, (line) => line.startsWith(`::error title=${code}::`))

  const sameAnnotations = (actual: ReadonlyArray<string>, expected: ReadonlyArray<string>): boolean =>
    actual.length === expected.length && actual.every((line, index) => line === expected[index])

  it.prop(
    '∀r_FailureRecord_≡AnnotationsCoverExactlyTheLocatedEvidence',
    { of: [FailureRecord], subject: annotationsOf },
    (subject, [record]) => {
      const expected = expectedAnnotationsOf(record)
      const annotations = subject(record)
      return expected.length === 0 ? summaryOnly(annotations, record._tag) : sameAnnotations(annotations, expected)
    },
  )

  it.prop(
    '∀r_FailureRecord_≡AnnotationsLeakNoInternalTag',
    { of: [FailureRecord], subject: annotationsOf },
    (subject, [record]) => !FORBIDDEN.test(subject(record).join(JOIN)),
  )

  it.prop(
    '∀r_FailureRecord_≡AnnotationsNeverSplitAWorkflowCommand',
    { of: [FailureRecord], subject: annotationsOf },
    (subject, [record]) => !LINE_BREAK.test(subject(record).join(JOIN)),
  )

  it.prop(
    '∀r_FailureRecord_≡TerminalTextLeaksNoInternalTag',
    { of: [FailureRecord], subject: terminalTextOf },
    (subject, [record]) => !FORBIDDEN.test(subject(record)),
  )

  it.prop(
    '∀r_FailureRecord_≡TerminalTextStatesTheNextAction',
    { of: [FailureRecord], subject: terminalTextOf },
    (subject, [record]) => subject(record).includes(`next: ${record.nextAction.primary}`),
  )

  it.prop(
    '∀r_FailureRecord_≡MarkdownLeaksNoInternalTag',
    { of: [FailureRecord], subject: markdownOf },
    (subject, [record]) => !FORBIDDEN.test(subject(record)),
  )

  it.prop(
    '∀r_FailureRecord_≡MarkdownStatesTheNextAction',
    { of: [FailureRecord], subject: markdownOf },
    (subject, [record]) => subject(record).includes(`\`${record.nextAction.primary}\``),
  )

  it.prop(
    '∀r_FailureRecord_≡SarifLeaksNoInternalTag',
    { of: [FailureRecord], subject: sarifTextOf },
    (subject, [record]) => !FORBIDDEN.test(subject(record)),
  )

  it.prop(
    '∀r_FailureRecord_≡SarifStatesTheNextAction',
    { of: [FailureRecord], subject: sarifTextOf },
    (subject, [record]) => subject(record).endsWith(`next: ${record.nextAction.primary}`),
  )
}
