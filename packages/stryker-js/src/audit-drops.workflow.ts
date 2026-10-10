import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  AuditedDrop,
  type AuditedPair,
  AuditScope,
  DropAuditFailed,
  DropAuditPassed,
  DropAuditReport,
  type FailReason,
  type MatrixMutant,
  MatrixProject,
  type OrphanedTest,
  type PairVerdict,
  type PassReason,
  type RuleSummary,
  type UnjoinableReason,
  type UnverifiedReason,
  type VacuousReason,
} from './audit.schema.js'

export class AuditDropsCommand extends S.TaggedClass<AuditDropsCommand>()('AuditDropsCommand', {
  scope: AuditScope,
  drops: S.Array(AuditedDrop),
  matrix: S.Array(MatrixProject),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

type Reason =
  | typeof PassReason.Type
  | typeof VacuousReason.Type
  | typeof UnverifiedReason.Type
  | typeof FailReason.Type
  | typeof UnjoinableReason.Type

const FIX_THE_RULE = "Fix the subsumption rule so it keeps this mutant, or set `mutator.mutantSetPolicy: 'full'`."
const RERUN_MATRIX = 'Re-run the kill-matrix lane on the current main, then audit again.'

const NEXT_ACTION: { readonly [reason in Reason]: string } = {
  'killers-contained': 'None: every test that kills the dominator also kills the dropped mutant.',
  'dropped-mutant-carries-no-kill-signal':
    'None: the dropped mutant never reached a test on main (CompileError, RuntimeError or Ignored), so dropping it loses no kill.',
  'dominator-survived':
    'None for the drop. To make the pair checkable, add a test that kills the dominator: it survives on main.',
  'dominator-uncovered':
    'None for the drop. To make the pair checkable, add a test that reaches the site: no test covers it on main.',
  'killer-is-file-hook':
    'Confirm by hand that the file-level failure in `missingKillers` also fails for the dropped mutant, or move that assertion into a named test so the kill is attributed.',
  'killer-unrecorded': `The dominator is Killed with no recorded killer. ${RERUN_MATRIX}`,
  'dropped-mutant-timed-out':
    "Confirm that every test in the dominator's killers times out on the dropped mutant: a Timeout records no killer.",
  'dominator-timed-out':
    'Confirm that every test the dominator times out under also kills the dropped mutant: a Timeout records no killer.',
  'killers-not-contained':
    `Signal lost: the tests in \`missingKillers\` kill the dominator but not the dropped mutant. ${FIX_THE_RULE}`,
  'dropped-mutant-survives':
    `Signal lost: the dropped mutant survives on main while its dominator is killed, so the drop hides a survivor. ${FIX_THE_RULE}`,
  'misidentified-pair':
    'The dominator is uncovered on main but the dropped mutant ran, so the rule paired two different sites. Fix the dominator the rule names.',
  'dominator-not-run':
    'The dominator never reached a test on main (CompileError, RuntimeError or Ignored), so it cannot stand in for the dropped mutant. Fix the rule so it names a dominator that runs.',
  'mutant-absent': `The kill matrix has no record of the dropped mutant. ${RERUN_MATRIX}`,
  'dominator-absent': `The kill matrix has no record of the dominator. ${RERUN_MATRIX}`,
  'status-unsettled': `The kill matrix holds the pair as Pending. ${RERUN_MATRIX}`,
}

const UNATTESTED_NEXT =
  `No drop of this rule joined the kill matrix, so nothing checks it. ${RERUN_MATRIX} Do not ship the rule until a pair joins.`

const ORPHANED_NEXT =
  `Signal lost: this test kills only dropped mutants, so it kills nothing once they are dropped. ${FIX_THE_RULE}`

interface ProjectIndex {
  readonly mutants: Record.ReadonlyRecord<string, MatrixMutant>
  readonly tests: ReadonlyArray<string>
}

interface PairKey {
  readonly project: string
  readonly rule: Mutant.Subsumed['rule']
  readonly mutant: Mutant.MutantId
  readonly dominator: Mutant.MutantId
}

interface JoinedFacts {
  readonly mutant: MatrixMutant
  readonly dominator: MatrixMutant
  readonly missingKillers: ReadonlyArray<string>
  readonly tests: ReadonlyArray<string>
}

type Judged = Result.Result<PairVerdict, typeof UnjoinableReason.Type>

const EMPTY_INDEX: ProjectIndex = { mutants: {}, tests: [] }

const pass = (reason: typeof PassReason.Type): Judged => Result.succeed({ _tag: 'Pass', reason })
const vacuous = (reason: typeof VacuousReason.Type): Judged => Result.succeed({ _tag: 'Vacuous', reason })
const unverified = (reason: typeof UnverifiedReason.Type): Judged =>
  Result.succeed({ _tag: 'AttributionUnverified', reason })
const fail = (reason: typeof FailReason.Type): Judged => Result.succeed({ _tag: 'Fail', reason })
const unsettled = (): Judged => Result.fail('status-unsettled')

const indexOf = (matrix: ReadonlyArray<MatrixProject>): Record.ReadonlyRecord<string, ProjectIndex> =>
  Object.fromEntries(matrix.map((project) => [
    project.project,
    { mutants: Object.fromEntries(project.mutants.map((mutant) => [mutant.id, mutant])), tests: project.tests },
  ]))

const containment = (facts: JoinedFacts): Judged =>
  Boolean.match(facts.dominator.killedBy.length === 0, {
    onTrue: () => unverified('killer-unrecorded'),
    onFalse: () =>
      Boolean.match(facts.missingKillers.length === 0, {
        onTrue: () => pass('killers-contained'),
        onFalse: () =>
          Boolean.match(facts.missingKillers.some((killer) => facts.tests.includes(killer)), {
            onTrue: () => fail('killers-not-contained'),
            onFalse: () => unverified('killer-is-file-hook'),
          }),
      }),
  })

const underKilledDominator = (facts: JoinedFacts): Judged =>
  Match.value(facts.mutant.status).pipe(
    Match.when('Killed', () => containment(facts)),
    Match.when('Timeout', () => unverified('dropped-mutant-timed-out')),
    Match.whenOr('Survived', 'NoCoverage', () => fail('dropped-mutant-survives')),
    Match.whenOr('CompileError', 'RuntimeError', 'Ignored', () => pass('dropped-mutant-carries-no-kill-signal')),
    Match.when('Pending', unsettled),
    Match.exhaustive,
  )

const underTimedOutDominator = (facts: JoinedFacts): Judged =>
  Match.value(facts.mutant.status).pipe(
    Match.whenOr('Killed', 'Timeout', () => unverified('dominator-timed-out')),
    Match.whenOr('Survived', 'NoCoverage', () => fail('dropped-mutant-survives')),
    Match.whenOr('CompileError', 'RuntimeError', 'Ignored', () => pass('dropped-mutant-carries-no-kill-signal')),
    Match.when('Pending', unsettled),
    Match.exhaustive,
  )

const underUncoveredDominator = (facts: JoinedFacts): Judged =>
  Match.value(facts.mutant.status).pipe(
    Match.whenOr('NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', () => vacuous('dominator-uncovered')),
    Match.whenOr('Killed', 'Survived', 'Timeout', () => fail('misidentified-pair')),
    Match.when('Pending', unsettled),
    Match.exhaustive,
  )

const settledOr = (facts: JoinedFacts, judged: () => Judged): Judged =>
  Boolean.match(facts.mutant.status === 'Pending', { onTrue: unsettled, onFalse: judged })

const judge = (facts: JoinedFacts): Judged =>
  Match.value(facts.dominator.status).pipe(
    Match.when('Killed', () => underKilledDominator(facts)),
    Match.when('Timeout', () => underTimedOutDominator(facts)),
    Match.when('Survived', () => settledOr(facts, () => vacuous('dominator-survived'))),
    Match.when('NoCoverage', () => underUncoveredDominator(facts)),
    Match.whenOr('CompileError', 'RuntimeError', 'Ignored', () => settledOr(facts, () => fail('dominator-not-run'))),
    Match.when('Pending', unsettled),
    Match.exhaustive,
  )

const factsOf = (index: ProjectIndex, mutant: MatrixMutant, dominator: MatrixMutant): JoinedFacts => ({
  mutant,
  dominator,
  missingKillers: dominator.killedBy.filter((killer) => !mutant.killedBy.includes(killer)),
  tests: index.tests,
})

const joinedOf = (index: ProjectIndex, key: PairKey): Result.Result<JoinedFacts, typeof UnjoinableReason.Type> =>
  Option.match(Record.get(index.mutants, key.mutant), {
    onNone: () => Result.fail('mutant-absent'),
    onSome: (mutant) =>
      Option.match(Record.get(index.mutants, key.dominator), {
        onNone: () => Result.fail('dominator-absent'),
        onSome: (dominator) => Result.succeed(factsOf(index, mutant, dominator)),
      }),
  })

const unjoinablePair = (key: PairKey, reason: typeof UnjoinableReason.Type): AuditedPair => ({
  _tag: 'UnjoinablePair',
  ...key,
  reason,
  next: NEXT_ACTION[reason],
})

const joinedPair = (key: PairKey, facts: JoinedFacts, verdict: PairVerdict): AuditedPair => ({
  _tag: 'JoinedPair',
  ...key,
  mutantStatus: facts.mutant.status,
  dominatorStatus: facts.dominator.status,
  missingKillers: facts.missingKillers,
  verdict,
  next: NEXT_ACTION[verdict.reason],
})

const auditPair = (indexes: Record.ReadonlyRecord<string, ProjectIndex>, key: PairKey): AuditedPair =>
  Result.match(joinedOf(Option.getOrElse(Record.get(indexes, key.project), () => EMPTY_INDEX), key), {
    onFailure: (reason) => unjoinablePair(key, reason),
    onSuccess: (facts) =>
      Result.match(judge(facts), {
        onFailure: (reason) => unjoinablePair(key, reason),
        onSuccess: (verdict) => joinedPair(key, facts, verdict),
      }),
  })

const pairKeysOf = (drop: AuditedDrop): ReadonlyArray<PairKey> =>
  drop.subsumed.dominators.map((dominator) => ({
    project: drop.project,
    rule: drop.subsumed.rule,
    mutant: drop.mutant,
    dominator,
  }))

const pairOrder: Order.Order<AuditedPair> = Order.combineAll([
  Order.mapInput(Order.String, (pair: AuditedPair) => pair.project),
  Order.mapInput(Order.String, (pair: AuditedPair) => pair.mutant),
  Order.mapInput(Order.String, (pair: AuditedPair) => pair.dominator),
])

type Tally = 'pass' | 'vacuous' | 'attributionUnverified' | 'fail' | 'unjoinable'

const tallyOf = (pair: AuditedPair): Tally =>
  Match.valueTags(pair, {
    UnjoinablePair: (): Tally => 'unjoinable',
    JoinedPair: (joined) =>
      Match.valueTags(joined.verdict, {
        Pass: (): Tally => 'pass',
        Vacuous: (): Tally => 'vacuous',
        AttributionUnverified: (): Tally => 'attributionUnverified',
        Fail: (): Tally => 'fail',
      }),
  })

const tallyCount = (pairs: ReadonlyArray<AuditedPair>, tally: Tally): number =>
  pairs.filter((pair) => tallyOf(pair) === tally).length

const ruleSummaryOf = (
  drops: Arr.NonEmptyReadonlyArray<AuditedDrop>,
  pairs: ReadonlyArray<AuditedPair>,
): RuleSummary => {
  const counts = {
    rule: Arr.headNonEmpty(drops).subsumed.rule,
    drops: drops.length,
    pass: tallyCount(pairs, 'pass'),
    vacuous: tallyCount(pairs, 'vacuous'),
    attributionUnverified: tallyCount(pairs, 'attributionUnverified'),
    fail: tallyCount(pairs, 'fail'),
    unjoinable: tallyCount(pairs, 'unjoinable'),
  }
  return Boolean.match(pairs.length > counts.unjoinable, {
    onTrue: (): RuleSummary => ({ _tag: 'Attested', ...counts }),
    onFalse: (): RuleSummary => ({ _tag: 'Unattested', ...counts, reason: 'no-drop-joined', next: UNATTESTED_NEXT }),
  })
}

const isUnattested = (rule: RuleSummary): boolean =>
  Match.valueTags(rule, { Attested: () => false, Unattested: () => true })

const orphansOf = (project: MatrixProject, drops: ReadonlyArray<AuditedDrop>): ReadonlyArray<OrphanedTest> => {
  const dropped: ReadonlyArray<string> = drops.filter((drop) => drop.project === project.project).map((drop) =>
    drop.mutant
  )
  const kills = project.mutants
    .filter((mutant) => mutant.status === 'Killed')
    .flatMap((mutant) => mutant.killedBy.map((test) => ({ test, mutant: mutant.id })))
    .filter((kill) => project.tests.includes(kill.test))
  return Object.entries(Arr.groupBy(kills, (kill) => kill.test)).flatMap(([test, killedBy]) =>
    Boolean.match(killedBy.every((kill) => dropped.includes(kill.mutant)), {
      onTrue: (): ReadonlyArray<OrphanedTest> => [{
        project: project.project,
        test,
        killed: Arr.map(killedBy, (kill) => kill.mutant),
        reason: 'every-killed-mutant-dropped',
        next: ORPHANED_NEXT,
      }],
      onFalse: () => [],
    })
  )
}

const orphanOrder: Order.Order<OrphanedTest> = Order.combine(
  Order.mapInput(Order.String, (orphan: OrphanedTest) => orphan.project),
  Order.mapInput(Order.String, (orphan: OrphanedTest) => orphan.test),
)

const decide = (command: AuditDropsCommand): DropAuditReport => {
  const indexes = indexOf(command.matrix)
  const pairs = Arr.sort(command.drops.flatMap(pairKeysOf).map((key) => auditPair(indexes, key)), pairOrder)
  const pairsByRule = Arr.groupBy(pairs, (pair) => pair.rule)
  const rules = Arr.sort(
    Object.values(Arr.groupBy(command.drops, (drop) => drop.subsumed.rule)).map((drops) =>
      ruleSummaryOf(
        drops,
        Option.getOrElse(Option.fromUndefinedOr(pairsByRule[Arr.headNonEmpty(drops).subsumed.rule]), () => []),
      )
    ),
    Order.mapInput(Order.String, (rule: RuleSummary) => rule.rule),
  )
  const orphanedTests = Arr.sort(command.matrix.flatMap((project) => orphansOf(project, command.drops)), orphanOrder)
  const fields = {
    schemaVersion: '1' as const,
    scope: command.scope,
    projects: command.matrix.map((project) => ({
      project: project.project,
      matrixMutants: project.mutants.length,
      drops: command.drops.filter((drop) => drop.project === project.project).length,
    })),
    rules,
    pairs,
    orphanedTests,
  }
  const failures = {
    pairs: tallyCount(pairs, 'fail'),
    unattestedRules: rules.filter(isUnattested).length,
    orphanedTests: orphanedTests.length,
  }
  return Boolean.match(failures.pairs + failures.unattestedRules + failures.orphanedTests === 0, {
    onTrue: (): DropAuditReport => DropAuditPassed.make(fields),
    onFalse: (): DropAuditReport => DropAuditFailed.make({ ...fields, failures }),
  })
}

export const auditDrops = Workflow.make({
  command: AuditDropsCommand,
  decision: DropAuditReport,
  error: S.Never,
  decide: (command): Result.Result<DropAuditReport, never> => Result.succeed(decide(command)),
})
