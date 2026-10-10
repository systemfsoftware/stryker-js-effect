import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const NonEmptyProjectTypeId = Symbol.for('@systemfsoftware/stryker-js/NonEmptyProjectDecision')
type NonEmptyProjectTypeId = typeof NonEmptyProjectTypeId

export class NonEmptyProjectCommand extends S.TaggedClass<NonEmptyProjectCommand>()('NonEmptyProjectCommand', {
  fileCount: S.Int,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    fileCount: 'stryker.non_empty_project.file_count',
  } as const
}

export class ProjectAdmitted extends S.TaggedClass<ProjectAdmitted>()('ProjectAdmitted', {}) {
  readonly [NonEmptyProjectTypeId] = NonEmptyProjectTypeId
}

export class ProjectEmpty extends S.TaggedClass<ProjectEmpty>()('ProjectEmpty', {}) {
  readonly [NonEmptyProjectTypeId] = NonEmptyProjectTypeId
}

export const NonEmptyProjectDecision = S.Union([ProjectAdmitted, ProjectEmpty])
export type NonEmptyProjectDecision = typeof NonEmptyProjectDecision.Type

export const admitNonEmptyProject = Workflow.make({
  command: NonEmptyProjectCommand,
  decision: NonEmptyProjectDecision,
  error: S.Never,
  decide: (command): Result.Result<NonEmptyProjectDecision, never> =>
    Result.succeed(
      Boolean.match(command.fileCount === 0, {
        onTrue: () => ProjectEmpty.make({}),
        onFalse: () => ProjectAdmitted.make({}),
      }),
    ),
})
