import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClassifyConfigImportCommand,
  classifyConfigImportFailure,
  ConfigImportClassified,
  ConfigImportCodedFailure,
  ConfigImportFailureCode,
  ConfigImportUnclassified,
} from '../run/classify-config-import-failure.workflow.js'

const fileArb = Arbitrary.schema(ClassifyConfigImportCommand.fields.file)
const nodeDetailArb = Arbitrary.schema(ConfigImportClassified.fields.nodeDetail)
const knownCodeArb = Arbitrary.schema(ConfigImportFailureCode)

describe('classifyConfigImportFailure', () => {
  it.prop(
    '∀c_KnownCode_≡ClassifiedWithTheCodeFileAndNodeDetail',
    { of: [fileArb, knownCodeArb, nodeDetailArb], subject: classifyConfigImportFailure },
    (subject, [file, code, detail]) => {
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
    '∀c_AnyStringCode_≡ClassifiedExactlyWhenTheCodeIsAKnownFailure',
    { of: [fileArb, Arbitrary.schema(S.String), nodeDetailArb], subject: classifyConfigImportFailure },
    (subject, [file, code, detail]) => {
      const decision = subject(
        ClassifyConfigImportCommand.make({ file, cause: Object.assign(new Error(detail), { code }) }),
      ).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigImportFailureCode)(code)
        ? S.is(ConfigImportClassified)(decision) && decision.code === code
        : S.is(ConfigImportUnclassified)(decision)
    },
  )

  it.prop(
    '∀c_ErrorWithoutCode_≡Unclassified',
    { of: [fileArb, nodeDetailArb], subject: classifyConfigImportFailure },
    (subject, [file, detail]) =>
      S.is(ConfigImportUnclassified)(
        subject(ClassifyConfigImportCommand.make({ file, cause: new Error(detail) })).pipe(
          Result.getOrElse((neverError) => neverError),
        ),
      ),
  )

  it.prop(
    '∀c_CodedFailureThatIsNoError_≡Unclassified',
    { of: [fileArb, Arbitrary.schema(ConfigImportCodedFailure)], subject: classifyConfigImportFailure },
    (subject, [file, cause]) =>
      S.is(ConfigImportUnclassified)(
        subject(ClassifyConfigImportCommand.make({ file, cause })).pipe(Result.getOrElse((neverError) => neverError)),
      ),
  )
})
