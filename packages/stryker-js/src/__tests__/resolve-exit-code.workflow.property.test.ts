import { describe, it } from '@effect/vitest'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ExitCodeResolved, resolveExitCode, ResolveExitCodeCommand } from '../resolve-exit-code.workflow.js'

const BASELINE_EXIT_CODES = {
  VerdictFail: 1,
  ConfigError: 2,
  RuntimeError: 3,
  InternalError: 4,
} as const

const codeOfResolution = (pending: ReadonlyArray<ExitClass>, signal: number | null) =>
  Result.match(
    resolveExitCode(new ResolveExitCodeCommand({ pending: [...pending], signal })),
    {
      onFailure: () => Number.NaN,
      onSuccess: (resolved) => S.is(ExitCodeResolved)(resolved) && resolved.code,
    },
  )

describe('resolveExitCode', () => {
  it.prop('∀class_ResolveExitCode_≡Baseline', [ExitClass], ([exitClass]) =>
    codeOfResolution([exitClass], null) === BASELINE_EXIT_CODES[exitClass],
  )

  it.prop('∀signal_ResolveExitCode_≡Offset', [S.Finite], ([signal]) =>
    codeOfResolution([], signal) === 128 + signal,
  )

  it.prop('∀empty_ResolveExitCode_≡Zero', [ExitClass], ([exitClass]) =>
    codeOfResolution(
      Result.match(
        resolveExitCode(new ResolveExitCodeCommand({ pending: [], signal: null })),
        {
          onFailure: () => [exitClass],
          onSuccess: () => [],
        },
      ),
      null,
    ) === 0,
  )
})
