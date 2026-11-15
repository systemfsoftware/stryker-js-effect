import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClassifyConfigImportCommand,
  classifyConfigImportFailure,
  ConfigImportClassified,
  ConfigImportUnclassified,
} from '../run/classify-config-import-failure.workflow.js'

const KNOWN_CODES: readonly string[] = [
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
]

const fileArb = Arbitrary.schema(S.String.check(S.isMinLength(1)))
const detailArb = Arbitrary.schema(S.String)

const knownCodeArb = Arbitrary.all({
  file: fileArb,
  detail: detailArb,
  code: Arbitrary.schema(
    S.Literals([
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      'ERR_UNKNOWN_FILE_EXTENSION',
      'ERR_MODULE_NOT_FOUND',
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
    ]),
  ),
})

const unknownCodeArb = Arbitrary.all({
  file: fileArb,
  code: Arbitrary.schema(S.String.check(S.isPattern(/^ERR_[A-Z_]+$/))).pipe(
    Arbitrary.filter((code) => KNOWN_CODES.includes(code) === false),
  ),
})

const nearMissCauseArb = Arbitrary.all({
  file: fileArb,
  code: Arbitrary.schema(
    S.Literals([
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      'ERR_UNKNOWN_FILE_EXTENSION',
      'ERR_MODULE_NOT_FOUND',
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
    ]),
  ),
  shape: Arbitrary.schema(S.Literals(['plain-object', 'code-missing', 'code-not-a-string', 'string'])),
})

const nearMissCauseOf = (
  shape: string,
  code: string,
): Error | { readonly code: string; readonly message: string } | string => {
  switch (shape) {
    case 'plain-object':
      return { code, message: 'boom' }
    case 'code-missing':
      return new Error(code)
    case 'code-not-a-string':
      return Object.assign(new Error('boom'), { code: KNOWN_CODES.indexOf(code) })
    default:
      return code
  }
}

describe('classifyConfigImportFailure', () => {
  it.prop(
    '∀c_KnownCode_≡ClassifiedWithTheCodeFileAndNodeDetail',
    { of: [knownCodeArb], subject: classifyConfigImportFailure },
    (subject, [{ file, detail, code }]) => {
      const decision = subject(
        ClassifyConfigImportCommand.make({ file, cause: Object.assign(new Error(detail), { code }) }),
      ).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigImportClassified)(decision) &&
        decision.code === code &&
        decision.file === file &&
        decision.nodeDetail === detail
    },
  )

  it.prop(
    '∀c_UnknownCode_≡UnknownCodeIsUnclassified',
    { of: [unknownCodeArb], subject: classifyConfigImportFailure },
    (subject, [{ file, code }]) => {
      const decision = subject(
        ClassifyConfigImportCommand.make({ file, cause: Object.assign(new Error('boom'), { code }) }),
      ).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigImportUnclassified)(decision)
    },
  )

  it.prop(
    '∀c_NotACodedError_≡NearMissCauseIsUnclassified',
    { of: [nearMissCauseArb], subject: classifyConfigImportFailure },
    (subject, [{ file, code, shape }]) => {
      const decision = subject(ClassifyConfigImportCommand.make({ file, cause: nearMissCauseOf(shape, code) })).pipe(
        Result.getOrElse((neverError) => neverError),
      )
      return S.is(ConfigImportUnclassified)(decision)
    },
  )
})
