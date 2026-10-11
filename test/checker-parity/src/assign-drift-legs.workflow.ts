import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ScopeSettings, seededOrder } from './Parity.schema.js'

const AssignDriftLegsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/AssignDriftLegs')
type AssignDriftLegsTypeId = typeof AssignDriftLegsTypeId

const PositiveInt = S.Int.check(S.isGreaterThanOrEqualTo(1))

export class AssignDriftLegsCommand extends S.TaggedClass<AssignDriftLegsCommand>()('AssignDriftLegsCommand', {
  settings: ScopeSettings,
  projects: S.Array(S.String),
  shards: PositiveInt,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class DriftProject extends S.Class<DriftProject>('DriftProject')({
  project: S.String,
  leg: PositiveInt,
}) {}

export class DriftLegsAssigned extends S.TaggedClass<DriftLegsAssigned>()('DriftLegsAssigned', {
  projects: S.Array(DriftProject),
}) {
  readonly [AssignDriftLegsTypeId] = AssignDriftLegsTypeId
}

export class NoDriftProjects extends S.TaggedClass<NoDriftProjects>()('NoDriftProjects', {}) {
  readonly [AssignDriftLegsTypeId] = AssignDriftLegsTypeId
}

export const DriftLegsDecision = S.Union([DriftLegsAssigned, NoDriftProjects])
export type DriftLegsDecision = typeof DriftLegsDecision.Type

const driftProjectsOf = (command: AssignDriftLegsCommand): ReadonlyArray<DriftProject> =>
  Arr.take(seededOrder(command.settings, command.projects), command.settings.driftProjects).map((project, rank) =>
    DriftProject.make({ project, leg: (rank % command.shards) + 1 })
  )

const assignDriftLegsOf = (command: AssignDriftLegsCommand): DriftLegsDecision => {
  const projects = driftProjectsOf(command)
  return Boolean.match(projects.length === 0, {
    onTrue: () => NoDriftProjects.make({}),
    onFalse: () => DriftLegsAssigned.make({ projects }),
  })
}

const decide = (command: AssignDriftLegsCommand): Result.Result<DriftLegsDecision, never> =>
  Result.succeed(assignDriftLegsOf(command))

export const assignDriftLegs = Workflow.make({
  command: AssignDriftLegsCommand,
  decision: DriftLegsDecision,
  error: S.Never,
  decide,
})
