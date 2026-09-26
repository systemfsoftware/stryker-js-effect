import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  ConfigImportDescribed,
  ConfigImportUnclassified,
  DescribeConfigImportCommand,
  describeConfigModuleFailure,
} from '../run/describe-config-module-failure.workflow.js'

const KNOWN_CODES: readonly string[] = [
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
]

const knownCodeArb = Arbitrary.all({
  file: Arbitrary.schema(S.String.check(S.isMinLength(1))),
  code: Arbitrary.schema(
    S.Literals([
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      'ERR_UNKNOWN_FILE_EXTENSION',
      'ERR_MODULE_NOT_FOUND',
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
    ]),
  ),
}).pipe(
  Arbitrary.map(({ file, code }) =>
    DescribeConfigImportCommand.make({
      file,
      message: code,
      cause: Object.assign(new Error('boom'), { code }),
    })
  ),
)

const unknownCodeArb = Arbitrary.schema(
  S.Struct({
    file: S.String.check(S.isMinLength(1)),
    code: S.String.check(S.isPattern(/^ERR_[A-Z_]+$/)),
  }),
).pipe(
  Arbitrary.filter(({ code }) => KNOWN_CODES.includes(code) === false),
  Arbitrary.map(({ file, code }) =>
    DescribeConfigImportCommand.make({
      file,
      message: code,
      cause: Object.assign(new Error('boom'), { code }),
    })
  ),
)

const nonErrorCauseArb = Arbitrary.all({
  file: Arbitrary.schema(S.String.check(S.isMinLength(1))),
  message: Arbitrary.schema(S.String.check(S.isMinLength(1))),
}).pipe(
  Arbitrary.map(({ file, message }) => DescribeConfigImportCommand.make({ file, message, cause: message })),
)

describe('describeConfigModuleFailure', () => {
  it.prop(
    '∀c_KnownCode_≡CodeIsDescribedAndTheFileIsNamed',
    { of: [knownCodeArb], subject: describeConfigModuleFailure },
    (subject, [command]) => {
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigImportDescribed)(decision) &&
        decision.code === command.message &&
        decision.message.includes(`"${command.file}"`)
    },
  )

  it.prop(
    '∀c_UnknownCode_≡UnknownCodeIsUnclassified',
    { of: [unknownCodeArb], subject: describeConfigModuleFailure },
    (subject, [command]) => {
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigImportUnclassified)(decision)
    },
  )

  it.prop(
    '∀c_NonError_≡NonErrorCauseIsUnclassified',
    { of: [nonErrorCauseArb], subject: describeConfigModuleFailure },
    (subject, [command]) => {
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigImportUnclassified)(decision)
    },
  )
})
