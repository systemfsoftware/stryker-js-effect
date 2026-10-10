import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { gateScoreBreak, GateScoreBreakCommand, ProjectScore } from '../gate-score-break.workflow.js'

const breaksOwnThreshold = (entry: ProjectScore): boolean =>
  Report.MutationScore.match(entry.score, {
    Scored: ({ percentage }) => entry.breakingThreshold !== null && percentage < entry.breakingThreshold,
    Unscored: () => false,
  })

const unscoredWithBreak = (entry: ProjectScore): boolean =>
  Report.MutationScore.match(entry.score, {
    Scored: () => false,
    Unscored: () => entry.breakingThreshold !== null,
  })

const breachedProjectsOf = (subject: typeof gateScoreBreak, projects: ReadonlyArray<ProjectScore>) =>
  Result.match(subject(GateScoreBreakCommand.make({ projects: [...projects] })), {
    onFailure: (refused) => ({ breached: refused.breaches.map((breach) => breach.project), judged: refused.projects }),
    onSuccess: () => ({ breached: [], judged: projects.length }),
  })

describe('gateScoreBreak', () => {
  it.prop(
    '∀p_Project_≡FailsIffScoredBelowItsOwnBreak',
    { of: [ProjectScore], subject: gateScoreBreak },
    (subject, [entry]) => {
      const result = subject(GateScoreBreakCommand.make({ projects: [entry] }))
      return Result.match(result, {
        onFailure: (refused) =>
          breaksOwnThreshold(entry) &&
          JSON.stringify(refused.breaches) === JSON.stringify([{
              project: entry.project,
              percentage: Report.MutationScore.match(entry.score, { Scored: (s) => s.percentage, Unscored: () => -1 }),
              threshold: entry.breakingThreshold,
            }]),
        onSuccess: (cleared) =>
          !breaksOwnThreshold(entry) &&
          JSON.stringify(cleared.unscored) === JSON.stringify(unscoredWithBreak(entry) ? [entry.project] : []),
      })
    },
  )

  it.prop(
    '∀pq_Projects_≡EachIsJudgedAgainstItsOwnBreakInInputOrder',
    { of: [ProjectScore, ProjectScore], subject: gateScoreBreak },
    (subject, [first, second]) =>
      JSON.stringify(breachedProjectsOf(subject, [first, second])) === JSON.stringify({
        breached: [
          ...(breaksOwnThreshold(first) ? [first.project] : []),
          ...(breaksOwnThreshold(second) ? [second.project] : []),
        ],
        judged: 2,
      }),
  )
})
