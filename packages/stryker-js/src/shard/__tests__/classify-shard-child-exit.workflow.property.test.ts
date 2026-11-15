import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyShardChildExit, ClassifyShardChildExitCommand } from '../classify-shard-child-exit.workflow.js'

const CONFIG_ERROR_CODE = 2

describe('classifyShardChildExit', () => {
  it.prop(
    '∀code_ExitCode_≡ConfiguredOnlyAtTheConfigurationExitCode',
    { of: [S.Int], subject: classifyShardChildExit },
    (subject, [exitCode]) => {
      const decision = Result.getOrElse(
        subject(ClassifyShardChildExitCommand.make({ exitCode })),
        (neverError) => neverError,
      )
      return decision.exitClass === (exitCode === CONFIG_ERROR_CODE ? 'ConfigError' : 'RuntimeError')
    },
  )
})
