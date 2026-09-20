import { type RunEvent, RunEventWireLine, S, type VerdictReached } from '@systemfsoftware/stryker-js'
import { ensureSkewChecker, type ExecResult, SKEW_EFFECT_VERSION } from './__fixtures__/container-environment.js'
import { type PreparedFixture, test } from './__fixtures__/container-harness.js'
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
const parseEventStream = (stdout: string): ReadonlyArray<RunEvent> =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => S.decodeUnknownSync(RunEventWireLine)(line))

const lastEvent = (events: ReadonlyArray<RunEvent>): RunEvent => {
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

test('running a mutation run whose checker worker was built on a different effect release', async ({ bdd, expect, prepareFixture }) => {
  let fixture: PreparedFixture
  let run: ExecResult
  let events: ReadonlyArray<RunEvent>
  let verdict: VerdictReached
  let spans: readonly TraceSpan[] = []

  await bdd.given('a fixture using a checker built on a skewed Effect version', async () => {
    const skewChecker = await ensureSkewChecker()
    fixture = await prepareFixture(SKEW_FIXTURE_URL, SKEW_FIXTURE_NAME, [skewChecker])
  })

  await bdd.when('the CLI runs with distributed tracing active', async () => {
    const startedSeconds = Math.floor(Date.now() / 1000) - 5
    run = await fixture.run(['run'])
    events = parseEventStream(run.stdout)
    const terminal = lastEvent(events)
    if (terminal._tag !== 'verdict') {
      throw new Error(`Expected verdict event, received: ${terminal._tag}`)
    }
    verdict = terminal

    if (telemetryEnabled) {
      spans = await pollWindowSpans({
        startSeconds: startedSeconds,
        serviceName: SERVICE_NAME,
        isSettled: (seen) => seen.some(isCheckerSpan) && seen.some(isWitnessSpan),
      })
    }
  })
  await bdd.thenAssert('the verdict tallies match the skew oracle despite the Effect version difference', () => {
    expect.soft(run.exitCode).toBe(0)
    expect.soft(verdict._tag).toBe('verdict')
    expect.soft(verdict.counts.killed).toBe(SKEW_ORACLE.killed)
    expect.soft(verdict.counts.survived).toBe(SKEW_ORACLE.survived)

    const reported = events.filter((e) => e._tag === 'mutant')
    expect.soft(reported).toHaveLength(SKEW_ORACLE.total)
  })

  if (telemetryEnabled) {
    await bdd.and('the OpenTelemetry spans link across the skewed worker boundary', () => {
      const checkerSpans = spans.filter(isCheckerSpan)
      const witnesses = spans.filter(isWitnessSpan)
      const hostTraceIds = new Set(spans.filter(isHostPhaseSpan).map((span) => span.traceId))
      const checkerTraceIds = new Set(checkerSpans.map((span) => span.traceId))

      expect.soft(checkerSpans.length).toBeGreaterThan(0)
      expect.soft(hostTraceIds.size).toBeGreaterThan(0)
      expect.soft([...checkerTraceIds].every((traceId) => hostTraceIds.has(traceId))).toBe(true)
      expect.soft(witnesses.length).toBeGreaterThan(0)
      expect.soft(witnesses.map(effectVersionOf)).toEqual(witnesses.map(() => SKEW_EFFECT_VERSION))
      expect.soft(witnesses.every((span) => checkerTraceIds.has(span.linkedTraceIds.at(0) ?? ''))).toBe(true)
    })
  }
})
