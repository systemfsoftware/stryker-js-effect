import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import {
  type BakeDone,
  type BakeFailed,
  BakePhases,
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
  failure: {
    readonly budgetSeconds: number
    readonly fixtures: ReadonlyArray<string>
    readonly bootSeconds: number
  },
): BakeReason => ({
  code: 'E2E_BAKE_OVER_BUDGET',
  detail: `The bake of ${
    failure.fixtures.join(', ')
  } ran past its ${failure.budgetSeconds}s budget while installing; pulling the guest image and booting the microVM took ${
    failure.bootSeconds.toFixed(1)
  } s of it.`,
  next:
    'if the npm registry was slow, re-run the job; if it runs over again, compare the e2e.setup.bake span in the e2e-telemetry artifact with the last green run.',
})

export const bootOverBudgetReason = (failure: { readonly budgetSeconds: number }): BakeReason => ({
  code: 'E2E_BAKE_BOOT_OVER_BUDGET',
  detail:
    `The bake ran past its ${failure.budgetSeconds}s budget while pulling the guest image and booting the preparation microVM, before any npm ci started.`,
  next:
    'if the image registry or the runner was slow, re-run the job; if it runs over again, compare the e2e.setup.bake span in the e2e-telemetry artifact with the last green run.',
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

const phasesOf = (done: Pick<BakeDone, 'phases'>): string =>
  Match.valueTags(done.phases, {
    NothingBaked: () => '',
    Baked: (phases) =>
      ` Pulling the guest image and booting the microVM took ${phases.bootSeconds.toFixed(1)} s, npm ci ${
        phases.installSeconds.toFixed(1)
      } s.`,
  })

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
    } s.${phasesOf(done)}`,
    '',
    '| Fixture | committed package-lock.json sha256 |',
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
  // the fork's `it` must stay out of the built module graph, so it loads only under this guard
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

  const OverBudget = S.Struct({
    budgetSeconds: S.Finite.check(S.isGreaterThan(0)),
    fixtures: S.NonEmptyArray(S.String),
    bootSeconds: S.Finite.check(S.isGreaterThan(0)),
  })

  const budgetReasons = (failure: typeof OverBudget.Type): ReadonlyArray<BakeReason> => [
    overBudgetReason(failure),
    bootOverBudgetReason({ budgetSeconds: failure.bootSeconds }),
  ]

  it.prop(
    '∀f_OverBudget_≡OneReasonPerBudgetNamingItsCeilingAndTheBootSeconds',
    { of: [OverBudget], subject: budgetReasons },
    (subject, [failure]) => {
      const [installing, booting] = subject(failure)
      return [
        installing.code === 'E2E_BAKE_OVER_BUDGET',
        booting.code === 'E2E_BAKE_BOOT_OVER_BUDGET',
        installing.code !== booting.code,
        installing.detail.includes(`${failure.budgetSeconds}s`),
        installing.detail.includes(`took ${failure.bootSeconds.toFixed(1)} s of it`),
        booting.detail.includes(`${failure.bootSeconds}s`),
      ].every((check) => check)
    },
  )

  it.prop(
    '∀p_BakePhases_≡PhasesOfNamesTheBakedTimesOrNothing',
    { of: [BakePhases], subject: phasesOf },
    (subject, [phases]) =>
      Match.valueTags(phases, {
        Baked: (baked) =>
          [
            subject({ phases }).includes(baked.bootSeconds.toFixed(1)),
            subject({ phases }).includes(baked.installSeconds.toFixed(1)),
          ].every((check) => check),
        NothingBaked: () => subject({ phases }) === '',
      }),
  )

  const outsideReasonCodes = [
    'E2E_BAKE_UNNAMED',
    'E2E_BAKE_NO_RECORD',
    'E2E_BAKE_BOOT_STALLED',
    'E2E_BAKE_OVER_BUDGET_SOON',
  ] as const

  const OutsideReasonLine = S.Struct({ code: S.Literals(outsideReasonCodes), exitCode: S.Int })

  const outsideVerdict = (line: typeof OutsideReasonLine.Type) => {
    const reasons = bakeReasonsOf({ stderrTail: `${line.code}: a detail Next: an action`, exitCode: line.exitCode })
    return {
      accepted: S.is(BakeReasonCode)(line.code),
      codes: reasons.map((reason) => reason.code),
      detail: reasons[0].detail,
    }
  }

  it.prop(
    '∀c_ReasonCodeOutsideTheClosedSet_⊥AcceptedAnd⊥NamedByBakeReasonsOf',
    { of: [OutsideReasonLine], subject: outsideVerdict },
    (subject, [line]) => {
      const verdict = subject(line)
      return [
        !verdict.accepted,
        verdict.codes.length === 1,
        verdict.codes[0] === 'E2E_BAKE_FAILED',
        verdict.detail.includes(String(line.exitCode)),
      ].every((check) => check)
    },
  )

  const HarnessReasonInput = S.Struct({
    budgetSeconds: S.Finite.check(S.isGreaterThan(0)),
    fixtures: S.NonEmptyArray(S.String),
    bootSeconds: S.Finite.check(S.isGreaterThan(0)),
    exitCode: S.Int.check(S.isGreaterThan(0)),
    message: S.NonEmptyString,
  })

  const harnessReasons = (input: typeof HarnessReasonInput.Type): ReadonlyArray<BakeReason> => [
    overBudgetReason(input),
    bootOverBudgetReason({ budgetSeconds: input.bootSeconds }),
    setupFailedReason(input.message),
    ...bakeReasonsOf({ stderrTail: 'the bake named no reason', exitCode: input.exitCode }),
  ]

  it.prop(
    '∀f_EveryHarnessReason_≡ACodeOfTheClosedSetNamingItsInputs',
    { of: [HarnessReasonInput], subject: harnessReasons },
    (subject, [input]) => {
      const reasons = subject(input)
      const detailOf = (code: BakeReasonCode): string =>
        Arr.findFirst(reasons, (reason) => reason.code === code).pipe(
          Option.map((reason) => reason.detail),
          Option.getOrElse(() => ''),
        )
      const installing = detailOf('E2E_BAKE_OVER_BUDGET')
      const booting = detailOf('E2E_BAKE_BOOT_OVER_BUDGET')
      const setup = detailOf('E2E_SETUP_FAILED')
      const unnamed = detailOf('E2E_BAKE_FAILED')
      return [
        reasons.every((reason) => S.is(BakeReasonCode)(reason.code)),
        installing.includes(`${input.budgetSeconds}s`),
        installing.includes(`took ${input.bootSeconds.toFixed(1)} s of it`),
        booting.includes(`${input.bootSeconds}s`),
        setup.includes(`Global setup failed before the bake finished: ${input.message.split('\n', 1)[0]}`),
        unnamed.includes(String(input.exitCode)),
      ].every((check) => check)
    },
  )
}
