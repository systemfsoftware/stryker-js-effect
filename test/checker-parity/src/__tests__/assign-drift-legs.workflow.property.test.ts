import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  assignDriftLegs,
  AssignDriftLegsCommand,
  DriftLegsAssigned,
  type DriftLegsDecision,
  type DriftProject,
  NoDriftProjects,
} from '../assign-drift-legs.workflow.js'

const decisionOf = (subject: typeof assignDriftLegs, command: AssignDriftLegsCommand): DriftLegsDecision =>
  Result.getOrThrow(subject(command))

const assignedOf = (decision: DriftLegsDecision): ReadonlyArray<DriftProject> =>
  S.is(DriftLegsAssigned)(decision) ? decision.projects : []

const legCounts = (assigned: ReadonlyArray<DriftProject>, shards: number): ReadonlyArray<number> =>
  Arr.range(1, Math.min(shards, assigned.length + 1)).map((leg) => assigned.filter((drift) => drift.leg === leg).length)

describe('assignDriftLegs', () => {
  it.prop(
    '∀a_Assigned_≡DistinctOwnProjectsUpToDriftProjects',
    { of: [AssignDriftLegsCommand], subject: assignDriftLegs },
    (subject, [command]) => {
      const decision = decisionOf(subject, command)
      const assigned = assignedOf(decision)
      const distinct = new Set(command.projects)
      const names = assigned.map((drift) => drift.project)
      return names.length === Math.min(command.settings.driftProjects, distinct.size) &&
        new Set(names).size === names.length && names.every((name) => distinct.has(name)) &&
        assigned.every((drift) => drift.leg >= 1 && drift.leg <= command.shards) &&
        S.is(NoDriftProjects)(decision) === (distinct.size === 0)
    },
  )

  it.prop(
    '∀b_Legs_≡FillFromTheFirstAndDifferByAtMostOne',
    { of: [AssignDriftLegsCommand], subject: assignDriftLegs },
    (subject, [command]) => {
      const assigned = assignedOf(decisionOf(subject, command))
      const used = Math.min(command.shards, assigned.length)
      const counts = legCounts(assigned, command.shards).slice(0, used)
      return counts.every((count) => count >= 1) &&
        Math.max(0, ...counts) - Math.min(...counts, Math.max(0, ...counts)) <= 1 &&
        assigned.every((drift) => drift.leg <= Math.max(used, 1))
    },
  )

  it.prop(
    '∀o_ProjectOrder_≡SameAssignment',
    { of: [AssignDriftLegsCommand], subject: assignDriftLegs },
    (subject, [command]) => {
      const reversed = AssignDriftLegsCommand.make({
        settings: command.settings,
        projects: Arr.reverse(command.projects),
        shards: command.shards,
      })
      const first = assignedOf(decisionOf(subject, command))
      const again = assignedOf(decisionOf(subject, reversed))
      return first.length === again.length &&
        Arr.every(Arr.zip(first, again), ([left, right]) => left.project === right.project && left.leg === right.leg)
    },
  )
})
