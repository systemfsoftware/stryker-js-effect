export interface CaseFailureSpan {
  readonly text: string
  readonly reason: string
  readonly type: string
}

/**
 * The facts of one failing case, carried on {@link IgnorerCaseFailed} so a caller holds the
 * failure as a value. The message renders from exactly these fields.
 */
export interface CaseFailure {
  readonly file: {
    readonly name: string
    readonly kind: 'ignored' | 'kept'
    readonly code: string
  }
  readonly failures: readonly string[]
  readonly received: readonly CaseFailureSpan[]
}

export const reasonSuffix = (reason: string) => ` reason ${JSON.stringify(reason)}`

const spanLine = (span: CaseFailureSpan) =>
  `- ${JSON.stringify(span.text)} (${span.type})${reasonSuffix(span.reason)}`

const receivedLines = (received: readonly CaseFailureSpan[]) =>
  received.length === 0 ? ['- none'] : received.map(spanLine)

const messageFor = (failure: CaseFailure) =>
  [
    `case ${JSON.stringify(failure.file.name)} (${failure.file.kind}) failed:`,
    'code:',
    failure.file.code,
    'failures:',
    ...failure.failures.map((one) => `- ${one}`),
    'received ignored spans:',
    ...receivedLines(failure.received),
  ].join('\n')

export class IgnorerCaseFailed extends Error {
  readonly _tag = 'IgnorerCaseFailed' as const
  constructor(readonly outcomes: readonly CaseFailure[]) {
    super(outcomes.map(messageFor).join('\n\n'))
  }
}