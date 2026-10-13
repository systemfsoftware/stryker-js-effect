import { assert, assertEqual } from './assert.ts'
import {
  type DropAuditReason,
  firstFailedStep,
  JOB_ORDER,
  matrixReasonOf,
  type Run,
  type Steps,
  stepsOf,
  verdictOf,
} from './drop-audit-verdict.ts'

const run: Run = {
  runId: '123',
  repository: 'o/r',
  runNumber: '9',
  projects: ['packages/b', 'packages/a'],
  matrixDir: 'kill-matrix',
  matrixArtifact: 'kill-matrix-9',
  auditOut: 'reports/audit.json',
  killMatrix: 'success',
}

const passed: Steps = Object.fromEntries(
  [...JOB_ORDER, 'download'].map((id) => [id, { outcome: 'success', outputs: {} }]),
)
const withStep = (id: string, outcome: string, outputs: Record<string, string> = {}): Steps => ({
  ...passed,
  [id]: { outcome, outputs },
})

Deno.test('a failed kill-matrix lane is MATRIX_MISSING whatever the download did', () => {
  assertEqual(matrixReasonOf('failure', false, ['packages/a']), 'MATRIX_MISSING')
  assertEqual(matrixReasonOf('skipped', true, []), 'MATRIX_MISSING')
})

Deno.test('a passed lane without a downloaded matrix is MATRIX_NOT_DOWNLOADED, not a lane failure', () => {
  assertEqual(matrixReasonOf('success', false, ['packages/a', 'packages/b']), 'MATRIX_NOT_DOWNLOADED')
})

Deno.test('a downloaded matrix missing a project is MATRIX_INCOMPLETE; a complete one passes', () => {
  assertEqual(matrixReasonOf('success', true, ['packages/b']), 'MATRIX_INCOMPLETE')
  assertEqual(matrixReasonOf('success', true, []), undefined)
})

Deno.test('a job whose steps all passed is DROP_AUDIT_OK, and the download step alone never fails it', () => {
  assertEqual(verdictOf(passed, run), { reason: 'DROP_AUDIT_OK', next: '' })
  assertEqual(verdictOf(withStep('download', 'failure'), run).reason, 'DROP_AUDIT_OK')
})

Deno.test('a failed step the reason table does not list is never read as OK', () => {
  assertEqual(verdictOf(withStep('start', 'failure'), run).reason, 'DROP_AUDIT_UNCLASSIFIED')
  const added = verdictOf(withStep('a-step-added-later', 'failure'), run)
  assertEqual(added.reason, 'DROP_AUDIT_UNCLASSIFIED')
  assert(added.next.includes('a-step-added-later'), 'the verdict names the unlisted step')
})

Deno.test('the earliest failed step in job order decides, and a cancelled one is a timeout', () => {
  const both: Steps = {
    ...withStep('upload', 'failure'),
    build: { outcome: 'failure', outputs: {} },
  }
  assertEqual(firstFailedStep(both), { id: 'build', outcome: 'failure' })
  assertEqual(verdictOf(withStep('audit', 'cancelled'), run).reason, 'DROP_AUDIT_TIMED_OUT')
})

Deno.test('matrix-check failures carry the reason the step wrote, and an incomplete matrix names the project', () => {
  assertEqual(
    verdictOf(withStep('matrix-check', 'failure', { reason: 'MATRIX_MISSING' }), run).reason,
    'MATRIX_MISSING',
  )
  assertEqual(
    verdictOf(withStep('matrix-check', 'failure', { reason: 'MATRIX_NOT_DOWNLOADED' }), run).reason,
    'MATRIX_NOT_DOWNLOADED',
  )
  const incomplete = verdictOf(
    withStep('matrix-check', 'failure', { reason: 'MATRIX_INCOMPLETE', absent: 'packages/b' }),
    run,
  )
  assertEqual(incomplete.reason, 'MATRIX_INCOMPLETE')
  assert(incomplete.next.includes('packages/b'), 'MATRIX_INCOMPLETE names the absent project')
  assertEqual(verdictOf(withStep('matrix-check', 'failure'), run).reason, 'DROP_AUDIT_UNCLASSIFIED')
})

Deno.test('the audit exit decides between a failed drop, a refused input and an unclassified exit', () => {
  assertEqual(verdictOf(withStep('audit', 'failure', { status: '1' }), run).reason, 'DROP_AUDIT_FAILED')
  assertEqual(verdictOf(withStep('audit', 'failure', { status: '2' }), run).reason, 'DROP_AUDIT_REFUSED')
  assertEqual(verdictOf(withStep('audit', 'failure', { status: '130' }), run).reason, 'DROP_AUDIT_UNCLASSIFIED')
  assertEqual(verdictOf(withStep('audit', 'failure'), run).reason, 'DROP_AUDIT_UNCLASSIFIED')
})

Deno.test('a failed audit reproduces from the workspace root with this run matrix and every project', () => {
  const next = verdictOf(withStep('audit', 'failure', { status: '1' }), run).next
  assert(
    next.endsWith(
      'Reproduce with: gh run download 123 -R o/r -n kill-matrix-9 -D kill-matrix' +
        ' && pnpm install --frozen-lockfile' +
        ' && pnpm exec turbo run build --filter=./packages/a --filter=./packages/b --filter=./packages/stryker-js' +
        ' && node packages/stryker-js/dist/main.mjs audit --matrix kill-matrix --projects packages/b,packages/a' +
        ' --out reports/audit.json',
    ),
    `the reproduce command is the job's own: ${next}`,
  )
})

Deno.test('each failed step maps to its own code, with a reproduce command or a re-run', () => {
  const failures: ReadonlyArray<readonly [Steps, DropAuditReason]> = [
    [withStep('install', 'failure'), 'DROP_AUDIT_INSTALL_FAILED'],
    [withStep('matrix-check', 'failure', { reason: 'MATRIX_MISSING' }), 'MATRIX_MISSING'],
    [withStep('matrix-check', 'failure', { reason: 'MATRIX_NOT_DOWNLOADED' }), 'MATRIX_NOT_DOWNLOADED'],
    [withStep('matrix-check', 'failure', { reason: 'MATRIX_INCOMPLETE', absent: 'packages/b' }), 'MATRIX_INCOMPLETE'],
    [withStep('build', 'failure'), 'DROP_AUDIT_BUILD_FAILED'],
    [withStep('audit', 'failure', { status: '1' }), 'DROP_AUDIT_FAILED'],
    [withStep('audit', 'failure', { status: '2' }), 'DROP_AUDIT_REFUSED'],
    [withStep('upload', 'failure'), 'DROP_AUDIT_UPLOAD_FAILED'],
    [withStep('checkout', 'failure'), 'DROP_AUDIT_UNCLASSIFIED'],
    [withStep('audit', 'cancelled'), 'DROP_AUDIT_TIMED_OUT'],
  ]
  for (const [steps, reason] of failures) {
    const verdict = verdictOf(steps, run)
    assertEqual(verdict.reason, reason)
    assert(
      verdict.next.includes('Reproduce with: ') || verdict.next.includes('gh run rerun 123') ||
        verdict.next.includes('gh workflow run mutation.yml'),
      `${verdict.reason} gives a command: ${verdict.next}`,
    )
  }
})

Deno.test("GitHub's toJSON(steps) payload decodes to the verdict its failed step names", () => {
  const payload = JSON.stringify({
    ...Object.fromEntries(
      [...JOB_ORDER, 'download'].map((id) => [id, { outputs: {}, outcome: 'success', conclusion: 'success' }]),
    ),
    audit: { outputs: { status: '2' }, outcome: 'failure', conclusion: 'failure' },
  })
  assertEqual(verdictOf(stepsOf(payload), run).reason, 'DROP_AUDIT_REFUSED')
})

Deno.test('a STEPS value that is not a JSON object is refused, never read as no failure', () => {
  for (const json of ['null', '"steps"', '3']) {
    let threw = false
    try {
      stepsOf(json)
    } catch {
      threw = true
    }
    assert(threw, `stepsOf(${json}) throws`)
  }
})
