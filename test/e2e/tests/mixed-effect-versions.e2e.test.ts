import type { ExpectStatic } from 'vitest'
import { ensureSkewChecker, type ExecResult, SKEW_EFFECT_VERSION } from './__fixtures__/container-environment.js'
import { test } from './__fixtures__/container-harness.js'
import { pollWindowSpans, type TraceSpan } from './__fixtures__/tempo.js'

const SKEW_FIXTURE_URL = new URL('../testResources/skew-fixture', import.meta.url)

const SKEW_ORACLE = { killed: 7, survived: 2, total: 9 } as const

const SKEW_FIXTURE_NAME = 'skew-fixture'

const WITNESS_SPAN_NAME = 'skew.check'

const CHECKER_SPAN_NAMES: readonly string[] = ['rpc.check', 'rpc.group']

const HOST_PHASE_SPAN_NAMES: readonly string[] = [
  'prepare',
  'instrument',
  'dryRun',
  'mutationTest',
  'mutationTest.batch',
]

const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e'

const telemetryEnabled = process.env['OTEL_ENABLED'] === 'true'

const stdoutLines = (stdout: string): readonly string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const parseEventLine = (line: string): unknown => {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object on stdout, received: ${line}`)
  }
  return value
}

const fieldOf = (event: unknown, field: string): unknown => {
  if (typeof event !== 'object' || event === null) {
    throw new Error(`no ${field} on a non-object event: ${JSON.stringify(event)}`)
  }
  return Reflect.get(event, field)
}

const numberFieldOf = (event: unknown, field: string): number => {
  const value = fieldOf(event, field)
  if (typeof value !== 'number') {
    throw new Error(`no numeric ${field} on: ${JSON.stringify(event)}`)
  }
  return value
}

const eventKind = (event: unknown): string => {
  const kind = fieldOf(event, 'kind')
  if (typeof kind !== 'string') {
    throw new Error(`an event carries no string kind: ${JSON.stringify(event)}`)
  }
  return kind
}

const lastEvent = (events: readonly unknown[]): unknown => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error('stdout carries no events')
  }
  return event
}

const isCheckerSpan = (span: TraceSpan): boolean => CHECKER_SPAN_NAMES.includes(span.name)

const isWitnessSpan = (span: TraceSpan): boolean => span.name === WITNESS_SPAN_NAME

const isHostPhaseSpan = (span: TraceSpan): boolean => HOST_PHASE_SPAN_NAMES.includes(span.name)

const effectVersionOf = (span: TraceSpan): string | undefined => span.attributes.get('effect.version')

test('running a mutation run whose checker worker was built on a different effect release', async ({ annotate, expect, prepareFixture }) => {
  await annotate('Step 1: Ensure skew checker and install fixture', 'lifecycle')
  const skewChecker = await ensureSkewChecker()
  const fixture = await prepareFixture(SKEW_FIXTURE_URL, SKEW_FIXTURE_NAME, [skewChecker])

  await annotate('Step 2: Execute CLI with OTel telemetry window', 'execution')
  const startedSeconds = Math.floor(Date.now() / 1000) - 5
  const run = await fixture.run(['run'])
  const events = stdoutLines(run.stdout).map(parseEventLine)
  const spans = telemetryEnabled
    ? await pollWindowSpans({
      startSeconds: startedSeconds,
      serviceName: SERVICE_NAME,
      isSettled: (seen) => seen.some(isCheckerSpan) && seen.some(isWitnessSpan),
    })
    : []

  await annotate('Step 3: Verify verdict counts, mutant totals, and cross-release trace links', 'assertions')
  const stepVerifySkewedVerdictAndCounts = (
    expect: ExpectStatic,
    run: ExecResult,
    verdict: unknown,
  ): void => {
    const counts = fieldOf(verdict, 'counts')
    expect(run.exitCode).toBe(0)
    expect(eventKind(verdict)).toBe('verdict')
    expect(numberFieldOf(counts, 'killed')).toBe(SKEW_ORACLE.killed)
    expect(numberFieldOf(counts, 'survived')).toBe(SKEW_ORACLE.survived)
  }

  const stepVerifyReportedMutantTotal = (
    expect: ExpectStatic,
    events: readonly unknown[],
  ): void => {
    const reported = events.filter((event) => eventKind(event) === 'mutant')
    expect(reported).toHaveLength(SKEW_ORACLE.total)
  }

  const stepVerifyTraceLinkage = (
    expect: ExpectStatic,
    spans: readonly TraceSpan[],
  ): void => {
    const checkerSpans = spans.filter(isCheckerSpan)
    const witnesses = spans.filter(isWitnessSpan)
    const hostTraceIds = new Set(spans.filter(isHostPhaseSpan).map((span) => span.traceId))
    const checkerTraceIds = new Set(checkerSpans.map((span) => span.traceId))

    expect(checkerSpans.length).toBeGreaterThan(0)
    expect(hostTraceIds.size).toBeGreaterThan(0)
    expect([...checkerTraceIds].every((traceId) => hostTraceIds.has(traceId))).toBe(true)
    expect(witnesses.length).toBeGreaterThan(0)
    expect(witnesses.map(effectVersionOf)).toEqual(witnesses.map(() => SKEW_EFFECT_VERSION))
    expect(witnesses.every((span) => checkerTraceIds.has(span.linkedTraceIds.at(0) ?? ''))).toBe(true)
  }

  const verdict = lastEvent(events)
  stepVerifySkewedVerdictAndCounts(expect, run, verdict)
  stepVerifyReportedMutantTotal(expect, events)
  if (telemetryEnabled) {
    stepVerifyTraceLinkage(expect, spans)
  }
})
