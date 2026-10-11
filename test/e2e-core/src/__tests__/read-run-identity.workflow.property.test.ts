import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { readRunIdentity, ReadRunIdentityCommand } from '../read-run-identity.workflow.js'
import { RunIdentitySource, RunIdentityUndecodable } from '../run-path.schema.js'

type IdentityField = 'projectRoot' | 'runInputsDigest' | 'mutantIds'

const MALFORMED_FILES = { 'src/a.ts': { mutants: [{ id: 0 }] } }

const brokenText = (source: RunIdentitySource, field: IdentityField, missing: boolean): string => {
  if (field === 'mutantIds') {
    const { files: _files, ...withoutFiles } = source
    return JSON.stringify(missing ? withoutFiles : { ...withoutFiles, files: MALFORMED_FILES })
  }
  const { [field]: _dropped, ...withoutField } = source
  return JSON.stringify(missing ? withoutField : { ...source, [field]: 0 })
}

describe('readRunIdentity', () => {
  it.prop(
    '∀sfm_ReportMissingOrMalformingAnIdentityField_≡RefusedNamingTheFile',
    {
      of: [
        S.NonEmptyString,
        RunIdentitySource,
        S.Literals(['projectRoot', 'runInputsDigest', 'mutantIds']),
        S.Boolean,
      ],
      subject: readRunIdentity,
    },
    (subject, [file, source, field, missing]) => {
      const result = subject(ReadRunIdentityCommand.make({ file, text: brokenText(source, field, missing) }))
      return Result.isFailure(result) &&
        S.is(RunIdentityUndecodable)(result.failure) &&
        result.failure.file === file &&
        result.failure.message.includes(file)
    },
  )
})
