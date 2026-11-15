import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import type { FrameRunEventDecision } from './frame-run-event.workflow.js'

const formatScore = (score: number | null): string =>
  Option.match(Option.fromNullishOr(score), {
    onNone: () => 'n/a',
    onSome: (val) => String(val),
  })

const refusalSummaryOf = (refused: RunEvent.ReuseRefusals): string =>
  Arr.join(
    Arr.map(
      Arr.filter(Object.entries(refused), ([, count]) => Predicate.isTruthy(count)),
      ([reason, count]) => `${reason} ${count}`,
    ),
    ', ',
  )

const refusedLineOf = (refused: RunEvent.ReuseRefusals): Option.Option<string> =>
  Option.map(
    Option.liftPredicate(refusalSummaryOf(refused), Predicate.isTruthy),
    (summary) => `refused ${summary}`,
  )

const discardSummaryOf = (discard: RunEvent.PlanReportDiscard): string =>
  Option.match(Option.fromUndefinedOr(discard.actual), {
    onNone: () => `prior report discarded (${discard.reason})`,
    onSome: (actual) => `prior report discarded (${discard.reason}: ${actual} != ${discard.expected})`,
  })

const planProjectLineOf = (project: RunEvent.PlanProjectReuse): string =>
  Arr.join(
    [
      `${project.project}: ${project.reused} reused, ${project.ran} to run`,
      ...Option.toArray(refusedLineOf(project.refused)),
      ...Option.toArray(Option.map(Option.fromUndefinedOr(project.discard), discardSummaryOf)),
    ],
    ', ',
  )

const planLinesOf = (event: RunEvent.PlanKnown): string =>
  [
    `plan ${event.total} mutants`,
    ...Option.getOrElse(Option.fromUndefinedOr(event.projects), (): readonly RunEvent.PlanProjectReuse[] => [])
      .map(planProjectLineOf),
  ].join('\n')

const formatTotal = (total: number | null): string =>
  Option.match(Option.fromNullishOr(total), {
    onNone: () => '?',
    onSome: (val) => String(val),
  })

const humanLineOf = (event: RunEvent.RunEvent): Option.Option<string> =>
  Match.value(event).pipe(
    Match.tag('plan', (e) => Option.some(planLinesOf(e))),
    Match.tag('phase', (e) => Option.some(`phase ${e.phase}`)),
    Match.tag('tick', (e) => Option.some(`${e.completed}/${formatTotal(e.total)} elapsed ${e.elapsedMs}ms`)),
    Match.tag(
      'verdict',
      (e) => Option.some(`score ${formatScore(e.score)} killed ${e.counts.killed} survived ${e.counts.survived}`),
    ),
    Match.tag('error', (e) => Option.some(`error ${e.error}`)),
    Match.tag('refused', (e) => Option.some(`refused ${e.rule}`)),
    Match.tag(
      'stream',
      'mutantTested',
      'worker',
      'help',
      'plugins',
      'formats',
      'skipped',
      'reuse',
      'tce',
      'mutant-detail',
      'feedback',
      () => Option.none(),
    ),
    Match.exhaustive,
  )

export const stderrLineOf = (decision: FrameRunEventDecision): Option.Option<string> =>
  Match.value(decision).pipe(
    Match.tag('EventFramed', (framed) =>
      Match.value(framed.state.mode).pipe(
        Match.when('human', () => humanLineOf(framed.event)),
        Match.orElse(() => Option.none()),
      )),
    Match.tag('EventSuppressed', () => Option.none()),
    Match.exhaustive,
  )
