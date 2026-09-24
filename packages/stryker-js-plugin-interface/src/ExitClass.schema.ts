import { SchemaGetter, SchemaTransformation } from 'effect'
import * as S from 'effect/Schema'

export const ExitClass = S.Literals(['VerdictFail', 'ConfigError', 'RuntimeError', 'InternalError'])

export type ExitClass = typeof ExitClass.Type

const BASELINE_EXIT_CODES = {
  VerdictFail: 1,
  ConfigError: 2,
  RuntimeError: 3,
  InternalError: 4,
} as const

const codeOfClass = (exitClass: ExitClass): number => BASELINE_EXIT_CODES[exitClass]

export const ExitCodeFromClass = S.decodeTo(
  S.Int,
  SchemaTransformation.transform({
    decode: codeOfClass,
    encode: SchemaGetter.forbiddenEncoding,
  }),
)(ExitClass)
