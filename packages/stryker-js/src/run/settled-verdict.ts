import { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

import type { CurrentVerdict, TimeoutEvidence } from '../IncrementalDiff.schema.js'
import { costTotalMsOf } from '../mutant-cost.js'
import {
  type CheckerEntry,
  type TestedComponents,
  type TestedEntry,
  type TestedStatus,
  TestedStatusSchema,
  type TimeoutKind,
  type VerdictEntry,
} from '../verdict-store/VerdictEntry.schema.js'
import { checkerComponentsOf, testedComponentsOf } from './current-verdict.js'

const timeoutKindIn = (reason: string | undefined): TimeoutKind | undefined =>
  Match.value(reason).pipe(
    Match.when(TestRunner.WallClockTimeoutReason.literal, (): TimeoutKind => 'wallClock'),
    Match.when(
      (candidate: string | undefined): boolean =>
        candidate !== undefined && S.is(TestRunner.HitLimitReasonText)(candidate),
      (): TimeoutKind => 'hitLimit',
    ),
    Match.orElse((): TimeoutKind | undefined => undefined),
  )

const evidenceKindOf = (evidence: TimeoutEvidence | undefined): TimeoutKind | undefined => evidence?.timeoutKind

const timeoutKindOf = (
  mutant: Mutant.RunMutantResult,
  evidence: TimeoutEvidence | undefined,
): TimeoutKind | undefined =>
  Option.getOrUndefined(
    Option.firstSomeOf(
      [Option.fromUndefinedOr(timeoutKindIn(mutant.statusReason)), Option.fromUndefinedOr(evidenceKindOf(evidence))],
    ),
  )

const reproducedCountOf = (timeoutKind: TimeoutKind, evidenceKind: TimeoutKind | undefined): number =>
  Match.value(timeoutKind).pipe(
    Match.when('wallClock', () =>
      Match.value(evidenceKind).pipe(
        Match.when('wallClock', () => 1),
        Match.orElse(() => 0),
      )),
    Match.orElse(() => 0),
  )

interface PersistedTimeoutFields {
  readonly timeoutKind?: TimeoutKind
  readonly reproductions?: number
}

const timeoutFieldsOf = (
  mutant: Mutant.RunMutantResult,
  evidence: TimeoutEvidence | undefined,
): PersistedTimeoutFields =>
  Boolean.match(mutant.status === 'Timeout', {
    onFalse: (): PersistedTimeoutFields => ({}),
    onTrue: () =>
      Option.match(Option.fromUndefinedOr(timeoutKindOf(mutant, evidence)), {
        onNone: (): PersistedTimeoutFields => ({}),
        onSome: (timeoutKind) => ({
          timeoutKind,
          reproductions: reproducedCountOf(timeoutKind, evidenceKindOf(evidence)),
        }),
      }),
  })

export interface SettledVerdict {
  readonly result: Mutant.RunMutantResult
  readonly current: CurrentVerdict
  readonly evidence: TimeoutEvidence | undefined
  readonly settledAt: number
}

const presentField = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: (): Partial<Record<K, V>> => ({}),
    onSome: (present) => Record.singleton(key, present),
  })

const measuredOf = (settled: SettledVerdict) => ({
  costMs: costTotalMsOf(settled.result.cost) ?? 0,
  settledAt: settled.settledAt,
})

const testedCommonOf = (settled: SettledVerdict, components: TestedComponents) => ({
  components,
  ...presentField('testsCompleted', settled.result.testsCompleted),
  ...presentField('coveredBy', settled.result.coveredBy),
  ...presentField('statusReason', settled.result.statusReason),
  ...measuredOf(settled),
})

const settledTestedEntryOf = (
  settled: SettledVerdict,
  components: TestedComponents,
  status: Exclude<TestedStatus, 'Ignored'>,
): TestedEntry =>
  Match.value(status).pipe(
    Match.when('Killed', (): TestedEntry => ({
      ...testedCommonOf(settled, components),
      ...presentField('killedBy', settled.result.killedBy),
      status: 'Killed',
    })),
    Match.when('Timeout', (): TestedEntry => ({
      ...testedCommonOf(settled, components),
      ...timeoutFieldsOf(settled.result, settled.evidence),
      status: 'Timeout',
    })),
    Match.when('Survived', (): TestedEntry => ({ ...testedCommonOf(settled, components), status: 'Survived' })),
    Match.orElse((): TestedEntry => ({ ...testedCommonOf(settled, components), status: 'NoCoverage' })),
  )

const ignoredEntryOf = (settled: SettledVerdict, components: TestedComponents): Option.Option<TestedEntry> =>
  Option.map(
    Option.filter(Option.fromUndefinedOr(settled.result.statusReason), S.is(Mutant.IgnoreStatusReasonText)),
    (statusReason): TestedEntry => ({ ...testedCommonOf(settled, components), status: 'Ignored', statusReason }),
  )

const testedEntryOf = (settled: SettledVerdict, status: TestedStatus): Option.Option<VerdictEntry> =>
  Option.flatMap(testedComponentsOf(settled.current), (components) =>
    Match.value(status).pipe(
      Match.when('Ignored', () => ignoredEntryOf(settled, components)),
      Match.orElse((settledStatus) => Option.some(settledTestedEntryOf(settled, components, settledStatus))),
    ))

const checkerEntryOf = (settled: SettledVerdict): Option.Option<VerdictEntry> =>
  Option.map(checkerComponentsOf(settled.current), (components): CheckerEntry => ({
    components,
    status: 'CompileError',
    ...presentField('statusReason', settled.result.statusReason),
    ...measuredOf(settled),
  }))

const contentKeyedEntryOf = (settled: SettledVerdict): Option.Option<VerdictEntry> =>
  Match.value(settled.result.status).pipe(
    Match.when(S.is(TestedStatusSchema), (status) => testedEntryOf(settled, status)),
    Match.when('CompileError', () => checkerEntryOf(settled)),
    Match.orElse(() => Option.none<VerdictEntry>()),
  )

const carriesNoSubsumption = (settled: SettledVerdict): boolean => settled.result.subsumption === undefined

export const settledEntryOf = (settled: SettledVerdict): Option.Option<VerdictEntry> =>
  Option.flatMap(Option.liftPredicate(settled, carriesNoSubsumption), contentKeyedEntryOf)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const { TimeoutEvidenceSchema } = await import('../IncrementalDiff.schema.js')
  const { MutantStatusSchema } = Mutant

  const holds = (conditions: readonly boolean[]) => conditions.every((condition) => condition)

  const expectedTimeoutKind = (result: Mutant.RunMutantResult, evidence: TimeoutEvidence): TimeoutKind =>
    Match.value(result.statusReason).pipe(
      Match.when('wall-clock-timeout', (): TimeoutKind => 'wallClock'),
      Match.when(
        (reason: string | undefined): boolean =>
          reason !== undefined && /^Hit limit reached \(\d+\/\d+\)$/.test(reason),
        (): TimeoutKind => 'hitLimit',
      ),
      Match.orElse((): TimeoutKind => evidence.timeoutKind),
    )

  const expectedReproductions = (timeoutKind: TimeoutKind, evidence: TimeoutEvidence): number =>
    Match.value(timeoutKind).pipe(
      Match.when('wallClock', () =>
        Match.value(evidence.timeoutKind).pipe(
          Match.when('wallClock', () => 1),
          Match.orElse(() => 0),
        )),
      Match.orElse(() => 0),
    )

  const expectedTimeoutFields = (result: Mutant.RunMutantResult, evidence: TimeoutEvidence) =>
    Match.value(result.status === 'Timeout').pipe(
      Match.when(true, () => ({
        timeoutKind: expectedTimeoutKind(result, evidence),
        reproductions: expectedReproductions(expectedTimeoutKind(result, evidence), evidence),
      })),
      Match.orElse(() => ({ timeoutKind: undefined, reproductions: undefined })),
    )

  interface TimeoutProbe {
    readonly result: Mutant.RunMutantResult
    readonly evidence: TimeoutEvidence | undefined
    readonly expected: PersistedTimeoutFields
  }

  /**
   * Inputs whose persisted timeout fields are known without the subject's logic: a wall-clock
   * timeout is credited only beside wall-clock evidence, a hit-limit timeout is never credited
   * as reproduced, and a non-timeout carries no timeout fields. The probes disagree with one
   * another, so they refute a constant impostor even when the draw holds no timeout case for
   * the model comparison to catch.
   */
  const timeoutProbes = (mutant: Mutant.Mutant): readonly TimeoutProbe[] => [
    {
      result: { ...mutant, status: 'Timeout', statusReason: TestRunner.WallClockTimeoutReason.literal },
      evidence: { timeoutKind: 'wallClock', reproductions: 3 },
      expected: { timeoutKind: 'wallClock', reproductions: 1 },
    },
    {
      result: { ...mutant, status: 'Timeout', statusReason: TestRunner.WallClockTimeoutReason.literal },
      evidence: { timeoutKind: 'hitLimit', reproductions: 7 },
      expected: { timeoutKind: 'wallClock', reproductions: 0 },
    },
    {
      result: { ...mutant, status: 'Timeout', statusReason: TestRunner.WallClockTimeoutReason.literal },
      evidence: undefined,
      expected: { timeoutKind: 'wallClock', reproductions: 0 },
    },
    {
      result: { ...mutant, status: 'Timeout', statusReason: 'Hit limit reached (3/10)' },
      evidence: { timeoutKind: 'wallClock', reproductions: 7 },
      expected: { timeoutKind: 'hitLimit', reproductions: 0 },
    },
    {
      result: { ...mutant, status: 'Survived', statusReason: TestRunner.WallClockTimeoutReason.literal },
      evidence: { timeoutKind: 'wallClock', reproductions: 7 },
      expected: {},
    },
  ]

  const timeoutProbesHold = (subject: typeof timeoutFieldsOf, mutant: Mutant.Mutant): boolean =>
    Arr.every(
      timeoutProbes(mutant),
      ({ result, evidence, expected }) => JSON.stringify(subject(result, evidence)) === JSON.stringify(expected),
    )

  it.prop(
    '∀mse_MutantStatusAndEvidence_≡PersistedTimeoutFieldsFollowTheReproductionRule',
    { of: [Mutant.Mutant, MutantStatusSchema, TimeoutEvidenceSchema], subject: timeoutFieldsOf },
    (subject, [mutant, status, evidence]) => {
      const result: Mutant.RunMutantResult = { ...mutant, status }
      return holds([
        JSON.stringify(subject(result, evidence)) === JSON.stringify(expectedTimeoutFields(result, evidence)),
        timeoutProbesHold(subject, mutant),
      ])
    },
  )
}
