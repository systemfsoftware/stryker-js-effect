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

const FileIdentityDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/FileIdentityDecision')

const FILE = 'src/a.ts'

type FormatIdentity = typeof FormatIdentitySchema.Type

const constantFrom = <Item = unknown, const A extends readonly [Item, ...Item[]] = readonly [Item, ...Item[]]>(
  ...values: A
): Arbitrary.Arbitrary<A[number]> =>
  Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: values.length - 1 }))).pipe(
    Arbitrary.flatMap((index) => {
      const chosen = values[index]
      if (chosen === undefined) {
        throw new Error(`constantFrom was asked for a value at index ${index}, which is unbound`)
      }
      return Arbitrary.Constant(chosen)
    }),
  )

const IDENTITY_FIELDS = ['formatId', 'ownerModule', 'ownerVersion'] as const

const driftField = (identity: FormatIdentity, field: (typeof IDENTITY_FIELDS)[number]): FormatIdentity => ({
  ...identity,
  [field]: `${identity[field]}-drifted`,
})

describe('admitFileIdentity', () => {
  it.prop(
    '∀d_Brand_∈FileIdentityDecision',
    { of: [FormatIdentitySchema, constantFrom(...IDENTITY_FIELDS)], subject: admitFileIdentity },
    (subject, [identity, field]) => {
      const matching = subject(
        AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed: identity }),
      )
      const drifted = subject(
        AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed: driftField(identity, field) }),
      )
      if (!Result.isSuccess(matching) || !Result.isSuccess(drifted)) {
        return false
      }
      return (
        Object.getOwnPropertySymbols(matching.success).includes(FileIdentityDecisionTypeId) &&
        Object.getOwnPropertySymbols(drifted.success).includes(FileIdentityDecisionTypeId)
      )
    },
  )

  it.prop(
    '∀ci_Command_∈TwoVariants',
    { of: [FormatIdentitySchema, constantFrom(0, 1, 2, 3)], subject: admitFileIdentity },
    (subject, [identity, shape]) => {
      const command = AdmitFileIdentityCommand.make({
        file: FILE,
        recorded: shape === 0 || shape === 1 || shape === 3 ? identity : undefined,
        claimed: shape === 0 || shape === 2 || shape === 3 ? identity : undefined,
      })
      const result = subject(command)
      if (!Result.isSuccess(result)) {
        return false
      }
      return S.is(FileIdentityReuse)(result.success) || S.is(FileIdentityRecompute)(result.success)
    },
  )

  it.prop(
    '∀i_MatchingIdentity_≡Reuse',
    { of: [FormatIdentitySchema], subject: admitFileIdentity },
    (subject, [identity]) => {
      const result = subject(AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed: identity }))
      return Result.isSuccess(result) && S.is(FileIdentityReuse)(result.success) && result.success.file === FILE
    },
  )

  it.prop(
    '∀if_AnyFieldDrift_≡Recompute',
    { of: [FormatIdentitySchema, constantFrom(...IDENTITY_FIELDS)], subject: admitFileIdentity },
    (subject, [identity, field]) => {
      const result = subject(
        AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed: driftField(identity, field) }),
      )
      return Result.isSuccess(result) && S.is(FileIdentityRecompute)(result.success) && result.success.file === FILE
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

  it.prop(
    '∀i_Command_≡ReuseIffIdentitiesAgree',
    { of: [FormatIdentitySchema, constantFrom(0, 1)], subject: admitFileIdentity },
    (subject, [identity, drift]) => {
      const claimed = drift === 0 ? identity : driftField(identity, 'formatId')
      const result = subject(AdmitFileIdentityCommand.make({ file: FILE, recorded: identity, claimed }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return S.is(FileIdentityReuse)(result.success) === (drift === 0)
    },
  )
})
