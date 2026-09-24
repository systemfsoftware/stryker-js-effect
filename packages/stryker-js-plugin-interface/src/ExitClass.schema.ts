import { SchemaTransformation } from 'effect'
import * as S from 'effect/Schema'

export const ExitClass = S.Literals(['VerdictFail', 'ConfigError', 'RuntimeError', 'InternalError'])

export type ExitClass = typeof ExitClass.Type

const BASELINE_EXIT_CODES = {
  VerdictFail: 1,
  ConfigError: 2,
  RuntimeError: 3,
  InternalError: 4,
} as const

const CLASS_BY_BASELINE_CODE = {
  1: 'VerdictFail',
  2: 'ConfigError',
  3: 'RuntimeError',
  4: 'InternalError',
} as const

const codeOfClass = (exitClass: ExitClass): 1 | 2 | 3 | 4 => BASELINE_EXIT_CODES[exitClass]

const classOfCode = (code: 1 | 2 | 3 | 4): ExitClass => CLASS_BY_BASELINE_CODE[code]

const BaselineExitCode = S.Literals([1, 2, 3, 4])

export const ExitCodeFromClass = S.decodeTo<typeof BaselineExitCode, typeof ExitClass, never, never>(
  BaselineExitCode,
  SchemaTransformation.transform({
    decode: codeOfClass,
    encode: classOfCode,
  }),
)(ExitClass)
