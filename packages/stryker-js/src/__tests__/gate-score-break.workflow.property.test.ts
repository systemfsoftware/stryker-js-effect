import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { gateScoreBreak, GateScoreBreakCommand, ProjectScore } from '../gate-score-break.workflow.js'

const breakOf = (entry: ProjectScore): number | null => entry.thresholds === null ? null : entry.thresholds.break

const breaksOwnThreshold = (entry: ProjectScore): boolean =>
  Report.MutationScore.match(entry.score, {
    Scored: ({ percentage }) => {
      const threshold = breakOf(entry)
      return threshold !== null && percentage < threshold
    },
    Unscored: () => false,
  })

const expectedNotesOf = (entry: ProjectScore): ReadonlyArray<string> => [
  ...Report.MutationScore.match(entry.score, {
    Scored: () => [],
    Unscored: () =>
      breakOf(entry) === null ? [] : [
        `stryker gate: ${entry.project} tested no valid mutant, so there is no mutation score to hold against thresholds.break`,
      ],
  }),
  ...(entry.thresholds === null
    ? [
      `stryker gate: ${entry.project}: no thresholds recorded for this project; re-run its shards with the project's config`,
    ]
    : []),
]

const breachedProjectsOf = (subject: typeof gateScoreBreak, projects: ReadonlyArray<ProjectScore>) =>
  Result.match(subject(GateScoreBreakCommand.make({ projects: [...projects] })), {
    onFailure: (refused) => ({ breached: refused.breaches.map((breach) => breach.project), judged: refused.projects }),
    onSuccess: () => ({ breached: [], judged: projects.length }),
  })

describe('gateScoreBreak', () => {
  it.prop(
    '∀p_Project_≡FailsIffScoredBelowItsOwnBreakAndOtherwiseNotesWhyNoVerdict',
    { of: [ProjectScore], subject: gateScoreBreak },
    (subject, [entry]) => {
      const result = subject(GateScoreBreakCommand.make({ projects: [entry] }))
      return Result.match(result, {
        onFailure: (refused) =>
          breaksOwnThreshold(entry) &&
          JSON.stringify(refused.breaches) === JSON.stringify([{
              project: entry.project,
              percentage: Report.MutationScore.match(entry.score, { Scored: (s) => s.percentage, Unscored: () => -1 }),
              threshold: breakOf(entry),
            }]),
        onSuccess: (cleared) =>
          !breaksOwnThreshold(entry) && JSON.stringify(cleared.lines) === JSON.stringify(expectedNotesOf(entry)),
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
