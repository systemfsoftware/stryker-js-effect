import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

import {
  type BakeDone,
  type BakeFailed,
  BakeReason,
  BakeReasonCode,
  type BakeRecord,
  type BakeReport,
} from './bake-report.schema.js'

type BakeState = 'BAKE_HIT' | 'BAKE_PARTIAL' | 'BAKE_FULL'

const REASON_LINE = /^(E2E_BAKE_[A-Z_]+): (.*?) Next: (.*)$/gm

const isReasonCode = S.is(BakeReasonCode)

const reasonOf = ([, code, detail, next]: RegExpExecArray): ReadonlyArray<BakeReason> =>
  isReasonCode(code) ? [{ code, detail, next }] : []

const unnamedFailure = (exitCode: number): BakeReason => ({
  code: 'E2E_BAKE_FAILED',
  detail: `The fixture bake exited ${exitCode} without naming a reason.`,
  next:
    'read the npm output the bake printed in the global setup error of the E2E lane log, then run that install on the host.',
})

export const bakeReasonsOf = (
  failure: { readonly stderrTail: string; readonly exitCode: number },
): Arr.NonEmptyReadonlyArray<BakeReason> =>
  Arr.match(Array.from(failure.stderrTail.matchAll(REASON_LINE)).flatMap(reasonOf), {
    onEmpty: (): Arr.NonEmptyReadonlyArray<BakeReason> => [unnamedFailure(failure.exitCode)],
    onNonEmpty: (reasons) => reasons,
  })

export const overBudgetReason = (
  failure: { readonly budgetSeconds: number; readonly fixtures: ReadonlyArray<string> },
): BakeReason => ({
  code: 'E2E_BAKE_OVER_BUDGET',
  detail: `The bake of ${failure.fixtures.join(', ')} did not finish within its ${failure.budgetSeconds}s budget.`,
  next:
    'if the registry was slow, re-run the job; if it runs over again, compare the e2e.setup.bake span in the e2e-telemetry artifact with the last green run.',
})

export const setupFailedReason = (message: string): BakeReason => ({
  code: 'E2E_SETUP_FAILED',
  detail: `Global setup failed before the bake finished: ${message.split('\n', 1)[0]}`,
  next: 'read the global setup error in the E2E lane log; the e2e-telemetry artifact holds the e2e.setup spans.',
})

const bakeStateOf = (done: Pick<BakeDone, 'baked' | 'fixtures'>): BakeState =>
  Boolean.match(done.baked === 0, {
    onTrue: () => 'BAKE_HIT',
    onFalse: () =>
      Boolean.match(done.baked === done.fixtures, { onTrue: () => 'BAKE_FULL', onFalse: () => 'BAKE_PARTIAL' }),
  })

const escapeData = (text: string): string => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

const escapeProperty = (text: string): string => escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

const annotationOf = (reason: BakeReason): string =>
  `::error title=${escapeProperty(reason.code)}::${escapeData(`${reason.detail} Next: ${reason.next}`)}`

const HEADING = '### Fixture bake'

const lockRow = ([fixtureId, digest]: readonly [string, string]): string => `| ${fixtureId} | \`${digest}\` |`

const doneReport = (done: BakeDone): BakeReport => ({
  packsKey: done.packsKey,
  baked: done.baked,
  entries: [...done.entries].sort(),
  summary: [
    HEADING,
    '',
    `\`${
      bakeStateOf(done)
    }\`: baked ${done.baked} of ${done.fixtures} fixtures, packs key \`${done.packsKey}\`; global setup took ${
      done.seconds.toFixed(1)
    } s.`,
    '',
    '| Fixture | package-lock.json sha256 |',
    '| --- | --- |',
    ...Object.entries(done.locks).sort(([left], [right]) => left.localeCompare(right)).map(lockRow),
    '',
  ].join('\n'),
  annotations: [],
})

const reasonItem = (reason: BakeReason): string => `- \`${reason.code}\`: ${reason.detail} Next: ${reason.next}`

const failedReport = (failed: BakeFailed): BakeReport => ({
  packsKey: '',
  baked: 0,
  entries: [],
  summary: [
    HEADING,
    '',
    `Global setup failed after ${failed.seconds.toFixed(1)} s.`,
    '',
    ...failed.reasons.map(reasonItem),
    '',
  ]
    .join('\n'),
  annotations: failed.reasons.map(annotationOf),
})

export const bakeReportOf = (record: BakeRecord): BakeReport =>
  Match.valueTags(record, { BakeDone: doneReport, BakeFailed: failedReport })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const unescapeData = (text: string): string =>
    text.replaceAll('%0A', '\n').replaceAll('%0D', '\r').replaceAll('%25', '%')

  it.prop(
    '∀r_Annotation_≡OneWorkflowCommandLineCarryingCodeDetailAndNext',
    { of: [BakeReason], subject: annotationOf },
    (subject, [reason]) => {
      const line = subject(reason)
      const prefix = `::error title=${reason.code}::`
      const checks = [
        !/[\r\n]/.test(line),
        line.startsWith(prefix),
        unescapeData(line.slice(prefix.length)) === `${reason.detail} Next: ${reason.next}`,
      ]
      return checks.every((check) => check)
    },
  )
}
