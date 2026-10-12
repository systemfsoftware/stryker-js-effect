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
const isUnkilledDominator = S.is(UNKILLED_DOMINATOR)

const joinDominatorStatusArb: Arbitrary.Arbitrary<Mutant.MutantStatus> = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((focused): Arbitrary.Arbitrary<Mutant.MutantStatus> =>
    focused ? Arbitrary.schema(UNKILLED_DOMINATOR) : Arbitrary.schema(Mutant.MutantStatusSchema)
  ),
)

const joinMutantStatusArb: Arbitrary.Arbitrary<Mutant.MutantStatus> = Arbitrary.schema(S.Boolean).pipe(
  Arbitrary.flatMap((pending): Arbitrary.Arbitrary<Mutant.MutantStatus> =>
    pending ? Arbitrary.Constant('Pending') : Arbitrary.schema(Mutant.MutantStatusSchema)
  ),
)

const joinScenarioArb: Arbitrary.Arbitrary<PairScenario> = Arbitrary.all({
  mutantStatus: joinMutantStatusArb,
  dominatorStatus: joinDominatorStatusArb,
  mutantKillers: killersArb,
  dominatorKillers: killersArb,
}).pipe(Arbitrary.map(({ mutantStatus, dominatorStatus, mutantKillers, dominatorKillers }) => ({
  mutant: { id: MUTANT, status: mutantStatus, killedBy: mutantKillers },
  dominator: { id: DOMINATOR, status: dominatorStatus, killedBy: dominatorKillers },
  mutantPresent: true,
  dominatorPresent: true,
  tests: NAMED_TESTS,
})))

const isJoined = (pair: AuditedPair): boolean =>
  Match.valueTags(pair, { JoinedPair: () => true, UnjoinablePair: () => false })

const isUnsettled = (pair: AuditedPair): boolean =>
  Match.valueTags(pair, {
    JoinedPair: () => false,
    UnjoinablePair: (unjoinable) => unjoinable.reason === 'status-unsettled',
  })

const REGIONS = ['clean', 'unattested', 'orphaned', 'free'] as const
const namedKillerArb = Arbitrary.schema(S.Literals(NAMED_TESTS))

const namedProjectOf = (mutants: ReadonlyArray<MatrixMutant>): MatrixProject => ({
  project: 'p',
  mutants,
  tests: NAMED_TESTS,
})

const auditProjectArb: Arbitrary.Arbitrary<MatrixProject> = Arbitrary.schema(S.Literals(REGIONS)).pipe(
  Arbitrary.flatMap((region) =>
    Match.value(region).pipe(
      Match.when('clean', () =>
        namedKillerArb.pipe(Arbitrary.map((killer) =>
          namedProjectOf([
            { id: MUTANT, status: 'Killed', killedBy: [killer] },
            { id: DOMINATOR, status: 'Killed', killedBy: [killer] },
          ])
        ))),
      Match.when('unattested', () =>
        statusArb.pipe(Arbitrary.map((status) => namedProjectOf([{ id: MUTANT, status, killedBy: [] }])))),
      Match.when('orphaned', () =>
        namedKillerArb.pipe(Arbitrary.map((killer) =>
          namedProjectOf([{ id: MUTANT, status: 'Killed', killedBy: [killer] }])
        ))),
      Match.when('free', () =>
        pairScenarioArb.pipe(Arbitrary.map(pairProjectOf))),
      Match.exhaustive,
    )
  ),
)

const recordOf = (project: MatrixProject, id: Mutant.MutantId): Option.Option<MatrixMutant> =>
  Arr.findFirst(project.mutants, (record) => record.id === id)

const killedByANamedTest = (project: MatrixProject, record: MatrixMutant): boolean =>
  record.status === 'Killed' && record.killedBy.some((killer) => project.tests.includes(killer))

const killedTogether = (project: MatrixProject): boolean =>
  Option.match(Option.all([recordOf(project, MUTANT), recordOf(project, DOMINATOR)]), {
    onNone: () => false,
    onSome: ([mutant, dominator]) =>
      mutant.status === 'Killed' && dominator.status === 'Killed' && mutant.killedBy.length > 0 &&
      mutant.killedBy.every((killer) => dominator.killedBy.includes(killer)) &&
      dominator.killedBy.every((killer) => mutant.killedBy.includes(killer)),
  })

const unattestedWith = (orphaned: boolean) => (project: MatrixProject): boolean =>
  Option.isNone(recordOf(project, DOMINATOR)) &&
  Option.match(recordOf(project, MUTANT), {
    onNone: () => false,
    onSome: (mutant) => killedByANamedTest(project, mutant) === orphaned,
  })

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
    {
      of: [joinScenarioArb],
      subject: auditDrops,
      cover: {
        'unkilled dominator with a pending mutant': [
          (scenario) => isUnkilledDominator(scenario.dominator.status) && scenario.mutant.status === 'Pending',
          0.1,
        ],
        'unkilled dominator with a settled mutant': [
          (scenario) => isUnkilledDominator(scenario.dominator.status) && scenario.mutant.status !== 'Pending',
          0.1,
        ],
      },
    },
    (subject, [scenario]) => {
      const settled = scenario.mutant.status !== 'Pending' && scenario.dominator.status !== 'Pending'
      return Option.match(Arr.head(reportOf(subject, pairCommandOf(scenario)).pairs), {
        onNone: () => false,
        onSome: (pair) => (settled ? isJoined(pair) : isUnsettled(pair)),
      })
    },
  )

  it.prop(
    '∀p_KillMatrix_≡ShouldFailTheAuditExactlyWhenAPairFailsARuleIsUnattestedOrATestIsOrphaned',
    {
      of: [auditProjectArb],
      subject: auditDrops,
      cover: {
        'clean audit': [killedTogether, 0.1],
        'unattested rule with no orphan': [unattestedWith(false), 0.1],
        'unattested rule with an orphan': [unattestedWith(true), 0.1],
      },
    },
    (subject, [project]) => {
      const report = reportOf(subject, commandOf(project, [dropOf(MUTANT, DOMINATOR)]))
      const ruleUnattested = Option.match(Arr.head(report.rules), {
        onNone: () => false,
        onSome: (rule) => Match.valueTags(rule, { Attested: () => false, Unattested: () => true }),
      })
      const failing = isFail(onlyVerdictOf(report)) || ruleUnattested || report.orphanedTests.length > 0
      return Match.valueTags(report, { DropAuditPassed: () => !failing, DropAuditFailed: () => failing })
    },
  )
})
