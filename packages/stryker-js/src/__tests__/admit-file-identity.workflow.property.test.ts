import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  admitFileIdentity,
  AdmitFileIdentityCommand,
  FileIdentityRecompute,
  FileIdentityReuse,
} from '../admit-file-identity.workflow.js'
import { FormatIdentitySchema } from '../IncrementalDiff.schema.js'

const FILE = 'src/a.ts'

type FormatIdentity = typeof FormatIdentitySchema.Type

const IDENTITY_FIELDS = ['formatId', 'ownerModule', 'ownerVersion'] as const

const identityFieldArb = Arbitrary.schema(S.Literals(IDENTITY_FIELDS))

const driftField = (identity: FormatIdentity, field: (typeof IDENTITY_FIELDS)[number]): FormatIdentity => ({
  ...identity,
  [field]: `${identity[field]}-drifted`,
})

describe('admitFileIdentity', () => {
  it.prop(
    '∀i_Command_≡ReuseIffIdentitiesAgree',
    {
      of: [FormatIdentitySchema, identityFieldArb, Arbitrary.schema(S.Boolean)],
      subject: admitFileIdentity,
    },
    (subject, [identity, field, agrees]) => {
      const claimed = agrees ? identity : driftField(identity, field)
      const result = subject(AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return S.is(FileIdentityReuse)(result.success) === agrees && result.success.file === FILE
    },
  )

  it.prop(
    '∀i_MissingRecorded_≡Recompute',
    { of: [FormatIdentitySchema], subject: admitFileIdentity },
    (subject, [identity]) => {
      const result = subject(
        AdmitFileIdentityCommand.make({ file: FILE, recorded: undefined, claimed: identity }),
      )
      return Result.isSuccess(result) && S.is(FileIdentityRecompute)(result.success) && result.success.file === FILE
    },
  )

  it.prop(
    '∀i_MissingClaim_≡Recompute',
    { of: [FormatIdentitySchema], subject: admitFileIdentity },
    (subject, [identity]) => {
      const result = subject(AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed: undefined }))
      return Result.isSuccess(result) && S.is(FileIdentityRecompute)(result.success) && result.success.file === FILE
    },
  )
})
