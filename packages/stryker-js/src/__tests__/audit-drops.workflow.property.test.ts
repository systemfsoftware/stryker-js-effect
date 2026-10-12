import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { auditDrops, AuditDropsCommand } from '../audit-drops.workflow.js'
import type {
  AuditedDrop,
  AuditedPair,
  DropAuditReport,
  MatrixMutant,
  MatrixProject,
  PairVerdict,
} from '../audit.schema.js'

const IDS = ['0000000000000000', '1111111111111111', '2222222222222222', '3333333333333333'] as const
const NAMED_TESTS = ['t1', 't2', 't3'] as const
const FILE_HOOK = 'src/a.test.ts#hook'
const MUTANT = Mutant.MutantId.make(IDS[0])
const DOMINATOR = Mutant.MutantId.make(IDS[1])

const killerArb = Arbitrary.schema(S.Literals([...NAMED_TESTS, FILE_HOOK]))
const killersArb = Arbitrary.array(killerArb, { maxLength: 3 }).pipe(Arbitrary.map(Arr.dedupe))

const statusArb: Arbitrary.Arbitrary<Mutant.MutantStatus> = Arbitrary.all({
  killed: Arbitrary.schema(S.Boolean),
  status: Arbitrary.schema(Mutant.MutantStatusSchema),
}).pipe(Arbitrary.map(({ killed, status }) => (killed ? 'Killed' : status)))

const recordArb = (id: string): Arbitrary.Arbitrary<MatrixMutant> =>
  Arbitrary.all({ status: statusArb, killedBy: killersArb }).pipe(
    Arbitrary.map(({ status, killedBy }) => ({ id, status, killedBy })),
  )

const catalogArb: Arbitrary.Arbitrary<ReadonlyArray<string>> = Arbitrary.array(
  Arbitrary.schema(S.Literals(NAMED_TESTS)),
  { maxLength: 1 },
).pipe(Arbitrary.map((unattributed) => NAMED_TESTS.filter((test) => !unattributed.includes(test))))

const dropOf = (mutant: Mutant.MutantId, dominator: Mutant.MutantId): AuditedDrop => ({
  project: 'p',
  mutant,
  subsumed: { _tag: 'Subsumed', rule: 'complement', dominators: [dominator] },
})

const commandOf = (project: MatrixProject, drops: ReadonlyArray<AuditedDrop>): AuditDropsCommand =>
  AuditDropsCommand.make({ scope: { _tag: 'Corpus' }, matrix: [project], drops })

interface PairScenario {
  readonly mutant: MatrixMutant
  readonly dominator: MatrixMutant
  readonly mutantPresent: boolean
  readonly dominatorPresent: boolean
  readonly tests: ReadonlyArray<string>
}

const pairScenarioArb: Arbitrary.Arbitrary<PairScenario> = Arbitrary.all({
  mutant: recordArb(MUTANT),
  dominator: recordArb(DOMINATOR),
  mutantPresent: Arbitrary.schema(S.Literals([true, true, true, false])),
  dominatorPresent: Arbitrary.schema(S.Literals([true, true, true, false])),
  tests: catalogArb,
})

const present = (record: MatrixMutant, isPresent: boolean): ReadonlyArray<MatrixMutant> => isPresent ? [record] : []

const pairProjectOf = (scenario: PairScenario): MatrixProject => ({
  project: 'p',
  mutants: [
    ...present(scenario.mutant, scenario.mutantPresent),
    ...present(scenario.dominator, scenario.dominatorPresent),
  ],
  tests: scenario.tests,
})

const pairCommandOf = (scenario: PairScenario): AuditDropsCommand =>
  commandOf(pairProjectOf(scenario), [dropOf(MUTANT, DOMINATOR)])

const reportOf = (subject: typeof auditDrops, command: AuditDropsCommand): DropAuditReport =>
  Result.getOrThrow(subject(command))

const verdictOf = (pair: AuditedPair): Option.Option<PairVerdict> =>
  Match.valueTags(pair, {
    JoinedPair: (joined) => Option.some(joined.verdict),
    UnjoinablePair: () => Option.none(),
  })

const onlyVerdictOf = (report: DropAuditReport): Option.Option<PairVerdict> =>
  Option.flatMap(Arr.head(report.pairs), verdictOf)

const isFail = (verdict: Option.Option<PairVerdict>): boolean =>
  Option.match(verdict, {
    onNone: () => false,
    onSome: (judged) =>
      Match.valueTags(judged, {
        Fail: () => true,
        Pass: () => false,
        Vacuous: () => false,
        AttributionUnverified: () => false,
      }),
  })

const isContainmentPass = (verdict: Option.Option<PairVerdict>): boolean =>
  Option.match(verdict, {
    onNone: () => false,
    onSome: (judged) =>
      Match.valueTags(judged, {
        Pass: (pass) => pass.reason === 'killers-contained',
        Fail: () => false,
        Vacuous: () => false,
        AttributionUnverified: () => false,
      }),
  })

const bothKilledAndJoined = (scenario: PairScenario): boolean =>
  scenario.mutantPresent && scenario.dominatorPresent &&
  scenario.mutant.status === 'Killed' && scenario.dominator.status === 'Killed'

interface OrphanSlot {
  readonly status: Mutant.MutantStatus
  readonly killsT1: boolean
  readonly dropped: boolean
  readonly others: ReadonlyArray<string>
}

const orphanSlotArb: Arbitrary.Arbitrary<OrphanSlot> = Arbitrary.all({
  status: statusArb,
  killsT1: Arbitrary.schema(S.Boolean),
  dropped: Arbitrary.schema(S.Boolean),
  others: Arbitrary.array(Arbitrary.schema(S.Literals(['t2', 't3'])), { maxLength: 2 }).pipe(Arbitrary.map(Arr.dedupe)),
})

interface OrphanScenario {
  readonly slots: ReadonlyArray<OrphanSlot>
  readonly t1Named: boolean
}

const orphanScenarioArb: Arbitrary.Arbitrary<OrphanScenario> = Arbitrary.all({
  slots: Arbitrary.all(IDS.map(() => orphanSlotArb)),
  t1Named: Arbitrary.schema(S.Literals([true, true, false])),
})

const orphanCommandOf = (scenario: OrphanScenario): AuditDropsCommand =>
  commandOf(
    {
      project: 'p',
      mutants: scenario.slots.map((slot, index) => ({
        id: IDS[index] ?? '',
        status: slot.status,
        killedBy: slot.killsT1 ? ['t1', ...slot.others] : slot.others,
      })),
      tests: scenario.t1Named ? NAMED_TESTS : ['t2', 't3'],
    },
    scenario.slots.flatMap((slot, index) =>
      slot.dropped ? [dropOf(Mutant.MutantId.make(IDS[index] ?? ''), DOMINATOR)] : []
    ),
  )

const t1OrphanedOf = (scenario: OrphanScenario): boolean => {
  const tally = scenario.slots.reduce(
    (acc, slot) => {
      const killedByT1 = slot.status === 'Killed' && slot.killsT1
      return { kills: acc.kills || killedByT1, allDropped: acc.allDropped && (!killedByT1 || slot.dropped) }
    },
    { kills: false, allDropped: true },
  )
  return scenario.t1Named && tally.kills && tally.allDropped
}

const dropsArb: Arbitrary.Arbitrary<ReadonlyArray<AuditedDrop>> = Arbitrary.array(
  Arbitrary.all({
    mutant: Arbitrary.schema(S.Literals(IDS)),
    first: Arbitrary.schema(S.Literals(IDS)),
    rest: Arbitrary.array(Arbitrary.schema(S.Literals(IDS)), { maxLength: 2 }),
  }).pipe(Arbitrary.map(({ mutant, first, rest }) => ({
    project: 'p',
    mutant: Mutant.MutantId.make(mutant),
    subsumed: {
      _tag: 'Subsumed' as const,
      rule: 'complement' as const,
      dominators: Arr.map([first, ...rest] as const, (id) => Mutant.MutantId.make(id)),
    },
  }))),
  { maxLength: 4 },
)

const UNKILLED_DOMINATOR = Mutant.MutantStatusSchema.pick(['Survived', 'CompileError', 'RuntimeError', 'Ignored'])
const SETTLED = Mutant.MutantStatusSchema.pick([
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
])

const bothPresentOf = (mutant: MatrixMutant, dominator: MatrixMutant): PairScenario => ({
  mutant,
  dominator,
  mutantPresent: true,
  dominatorPresent: true,
  tests: NAMED_TESTS,
})

const underUnkilledDominatorArb = (
  mutantStatus: Arbitrary.Arbitrary<Mutant.MutantStatus>,
): Arbitrary.Arbitrary<PairScenario> =>
  Arbitrary.all({
    mutantStatus,
    dominatorStatus: Arbitrary.schema(UNKILLED_DOMINATOR),
    mutantKillers: killersArb,
    dominatorKillers: killersArb,
  }).pipe(Arbitrary.map(({ mutantStatus, dominatorStatus, mutantKillers, dominatorKillers }) =>
    bothPresentOf(
      { id: MUTANT, status: mutantStatus, killedBy: mutantKillers },
      { id: DOMINATOR, status: dominatorStatus, killedBy: dominatorKillers },
    )
  ))

const joinDrawArb = Arbitrary.all({
  pending: underUnkilledDominatorArb(Arbitrary.Constant('Pending')),
  settled: SETTLED.pipe(Arbitrary.schema, underUnkilledDominatorArb),
  free: Arbitrary.all({ mutant: recordArb(MUTANT), dominator: recordArb(DOMINATOR) }).pipe(
    Arbitrary.map(({ mutant, dominator }) => bothPresentOf(mutant, dominator)),
  ),
})

const isJoined = (pair: AuditedPair): boolean =>
  Match.valueTags(pair, { JoinedPair: () => true, UnjoinablePair: () => false })

const isUnsettled = (pair: AuditedPair): boolean =>
  Match.valueTags(pair, {
    JoinedPair: () => false,
    UnjoinablePair: (unjoinable) => unjoinable.reason === 'status-unsettled',
  })

const namedKillerArb = Arbitrary.schema(S.Literals(NAMED_TESTS))

const namedProjectOf = (mutants: ReadonlyArray<MatrixMutant>): MatrixProject => ({
  project: 'p',
  mutants,
  tests: NAMED_TESTS,
})

const auditDrawArb = Arbitrary.all({
  clean: namedKillerArb.pipe(Arbitrary.map((killer) =>
    namedProjectOf([
      { id: MUTANT, status: 'Killed', killedBy: [killer] },
      { id: DOMINATOR, status: 'Killed', killedBy: [killer] },
    ])
  )),
  unattested: statusArb.pipe(Arbitrary.map((status) => namedProjectOf([{ id: MUTANT, status, killedBy: [] }]))),
  orphaned: namedKillerArb.pipe(
    Arbitrary.map((killer) => namedProjectOf([{ id: MUTANT, status: 'Killed', killedBy: [killer] }])),
  ),
  failing: Arbitrary.all({ status: Arbitrary.schema(Mutant.SurvivorStatusSchema), killer: namedKillerArb }).pipe(
    Arbitrary.map(({ status, killer }) =>
      namedProjectOf([
        { id: MUTANT, status, killedBy: [] },
        { id: DOMINATOR, status: 'Killed', killedBy: [killer] },
      ])
    ),
  ),
  free: pairScenarioArb.pipe(Arbitrary.map(pairProjectOf)),
})

const joinsExactlyWhenSettled = (subject: typeof auditDrops, scenario: PairScenario): boolean => {
  const settled = scenario.mutant.status !== 'Pending' && scenario.dominator.status !== 'Pending'
  return Option.match(Arr.head(reportOf(subject, pairCommandOf(scenario)).pairs), {
    onNone: () => false,
    onSome: (pair) => (settled ? isJoined(pair) : isUnsettled(pair)),
  })
}

const auditOf = (subject: typeof auditDrops, project: MatrixProject): DropAuditReport =>
  reportOf(subject, commandOf(project, [dropOf(MUTANT, DOMINATOR)]))

const passes = (report: DropAuditReport): boolean =>
  Match.valueTags(report, { DropAuditPassed: () => true, DropAuditFailed: () => false })

const tagMatchesFailures = (report: DropAuditReport): boolean => {
  const ruleUnattested = Option.match(Arr.head(report.rules), {
    onNone: () => false,
    onSome: (rule) => Match.valueTags(rule, { Attested: () => false, Unattested: () => true }),
  })
  const failing = isFail(onlyVerdictOf(report)) || ruleUnattested || report.orphanedTests.length > 0
  return passes(report) === !failing
}

describe('auditDrops', () => {
  it.prop(
    '∀d_Drops_≡ShouldAuditOnePairWhenADropNamesADominator',
    { of: [dropsArb], subject: auditDrops },
    (subject, [drops]) =>
      reportOf(subject, commandOf({ project: 'p', mutants: [], tests: [] }, drops)).pairs.length ===
        drops.reduce((count, drop) => count + drop.subsumed.dominators.length, 0),
  )

  it.prop(
    '∀s_DroppedPair_≡ShouldFailWhenANamedTestKillsTheDominatorButNotTheMutant',
    { of: [pairScenarioArb], subject: auditDrops },
    (subject, [scenario]) => {
      const lostNamedKill = bothKilledAndJoined(scenario) &&
        scenario.dominator.killedBy.some((killer) =>
          scenario.tests.includes(killer) && !scenario.mutant.killedBy.includes(killer)
        )
      return !lostNamedKill || isFail(onlyVerdictOf(reportOf(subject, pairCommandOf(scenario))))
    },
  )

  it.prop(
    '∀s_DroppedPair_≡ShouldPassContainmentOnlyWhenEveryDominatorKillerKillsTheMutant',
    { of: [pairScenarioArb], subject: auditDrops },
    (subject, [scenario]) => {
      const contained = bothKilledAndJoined(scenario) && scenario.dominator.killedBy.length > 0 &&
        scenario.dominator.killedBy.every((killer) => scenario.mutant.killedBy.includes(killer))
      return contained === isContainmentPass(onlyVerdictOf(reportOf(subject, pairCommandOf(scenario))))
    },
  )

  it.prop(
    '∀s_DroppedPair_≡ShouldFailWhenTheMutantSurvivesAKilledDominator',
    { of: [pairScenarioArb], subject: auditDrops },
    (subject, [scenario]) => {
      const hidesSurvivor = scenario.mutantPresent && scenario.dominatorPresent &&
        scenario.dominator.status === 'Killed' &&
        (scenario.mutant.status === 'Survived' || scenario.mutant.status === 'NoCoverage')
      return !hidesSurvivor || isFail(onlyVerdictOf(reportOf(subject, pairCommandOf(scenario))))
    },
  )

  it.prop(
    '∀s_DroppedPair_≡ShouldLeaveTheRuleUnattestedWhenThePairDoesNotJoin',
    { of: [pairScenarioArb], subject: auditDrops },
    (subject, [scenario]) => {
      const joins = scenario.mutantPresent && scenario.dominatorPresent &&
        scenario.mutant.status !== 'Pending' && scenario.dominator.status !== 'Pending'
      const attested = Option.match(Arr.head(reportOf(subject, pairCommandOf(scenario)).rules), {
        onNone: () => false,
        onSome: (rule) => Match.valueTags(rule, { Attested: () => true, Unattested: () => false }),
      })
      return attested === joins
    },
  )

  it.prop(
    '∀s_DroppedPair_≡ShouldFailTheAuditWhenThePairFails',
    { of: [pairScenarioArb], subject: auditDrops },
    (subject, [scenario]) => {
      const report = reportOf(subject, pairCommandOf(scenario))
      const failed = Match.valueTags(report, { DropAuditPassed: () => false, DropAuditFailed: () => true })
      return !isFail(onlyVerdictOf(report)) || failed
    },
  )

  it.prop(
    '∀k_KillMatrix_≡ShouldReportAnOrphanWhenEveryMutantANamedTestKillsIsDropped',
    { of: [orphanScenarioArb], subject: auditDrops },
    (subject, [scenario]) =>
      reportOf(subject, orphanCommandOf(scenario)).orphanedTests.some((orphan) => orphan.test === 't1') ===
        t1OrphanedOf(scenario),
  )

  it.prop(
    '∀s_DroppedPair_≡ShouldJoinExactlyWhenNeitherStatusIsPending',
    { of: [joinDrawArb], subject: auditDrops },
    (subject, [draw]) =>
      joinsExactlyWhenSettled(subject, draw.pending) && joinsExactlyWhenSettled(subject, draw.settled) &&
      joinsExactlyWhenSettled(subject, draw.free),
  )

  it.prop(
    '∀p_KillMatrix_≡ShouldFailTheAuditExactlyWhenAPairFailsARuleIsUnattestedOrATestIsOrphaned',
    { of: [auditDrawArb], subject: auditDrops },
    (subject, [draw]) =>
      passes(auditOf(subject, draw.clean)) && !passes(auditOf(subject, draw.unattested)) &&
      !passes(auditOf(subject, draw.orphaned)) && !passes(auditOf(subject, draw.failing)) &&
      tagMatchesFailures(auditOf(subject, draw.free)),
  )
})
