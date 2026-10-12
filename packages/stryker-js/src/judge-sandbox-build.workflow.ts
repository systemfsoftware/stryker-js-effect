import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { StrykerError } from './stryker-error.schema.js'

const JudgeSandboxBuildTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/JudgeSandboxBuild')
type JudgeSandboxBuildTypeId = typeof JudgeSandboxBuildTypeId

export class SandboxBuildCommand extends S.TaggedClass<SandboxBuildCommand>()('SandboxBuildCommand', {
  command: S.String,
  exitCode: S.Int,
  stderr: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class SandboxBuilt extends S.TaggedClass<SandboxBuilt>()('SandboxBuilt', {}) {
  readonly [JudgeSandboxBuildTypeId] = JudgeSandboxBuildTypeId
}

const failureOf = (command: SandboxBuildCommand): StrykerError =>
  StrykerError.make({
    message: `Build command "${command.command}" failed with exit code ${String(command.exitCode)}.\n${command.stderr}`,
  })

const decide = (command: SandboxBuildCommand): Result.Result<SandboxBuilt, StrykerError> =>
  Boolean.match(command.exitCode === 0, {
    onTrue: () => Result.succeed(SandboxBuilt.make({})),
    onFalse: () => Result.fail(failureOf(command)),
  })

export const judgeSandboxBuild = Workflow.make({
  command: SandboxBuildCommand,
  decision: SandboxBuilt,
  error: StrykerError,
  decide,
})
