import * as S from 'effect/Schema'

type ExitClassName = 'VerdictFail' | 'ConfigError' | 'RuntimeError' | 'InternalError'

const BASELINE_EXIT_CODES = {
  VerdictFail: 1,
  ConfigError: 2,
  RuntimeError: 3,
  InternalError: 4,
} as const

export const ExitClass = Object.assign(S.Literals(['VerdictFail', 'ConfigError', 'RuntimeError', 'InternalError']), {
  EXIT_CODE: BASELINE_EXIT_CODES,
  codeOf: (exitClass: ExitClassName) => BASELINE_EXIT_CODES[exitClass],
})

export type ExitClass = typeof ExitClass.Type
