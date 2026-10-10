import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { judgeSandboxBuild, SandboxBuildCommand } from '../judge-sandbox-build.workflow.js'

describe('judgeSandboxBuild', () => {
  it.prop(
    '∀c_JudgeSandboxBuild_⊨PassesIffExitCodeIsZero',
    { of: [SandboxBuildCommand], subject: judgeSandboxBuild },
    (subject, [command]) => Result.isSuccess(subject(command)) === (command.exitCode === 0),
  )

  it.prop(
    '∀c_JudgeSandboxBuild_⊨FailureNamesCommandExitCodeAndStderr',
    { of: [SandboxBuildCommand], subject: judgeSandboxBuild },
    (subject, [command]) =>
      Result.match(subject(command), {
        onSuccess: () => command.exitCode === 0,
        onFailure: (error) =>
          error.message ===
            `Build command "${command.command}" failed with exit code ${String(command.exitCode)}.\n${command.stderr}`,
      }),
  )
})
