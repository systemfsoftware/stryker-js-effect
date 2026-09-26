import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  explainFileSkip,
  ExplainFileSkipCommand,
  SkipKnownExplained,
  SkipUnknownExplained,
} from '../run/explain-file-skip.workflow.js'

const EXTENSION_PATTERN = /^\.[a-z][a-z0-9]{0,5}$/
const PACKAGE_PATTERN = /^@[a-z]{1,8}\/[a-z]{1,8}$/

const claimedReasonOf = (extension: string, joined: string): string =>
  `No loaded framework claims "${extension}". Add ${joined} to "plugins" to instrument it.`

const unclaimedReasonOf = (extension: string): string =>
  `No loaded framework claims "${extension}". No installed package declares it as a framework plugin: install the framework plugin that claims this file type and add it to "plugins" to instrument it.`

const soloCommandArb = Arbitrary.schema(
  S.Struct({
    extension: S.String.check(S.isPattern(EXTENSION_PATTERN)),
    owner: S.String.check(S.isPattern(PACKAGE_PATTERN)),
    decoy: S.optional(S.String.check(S.isPattern(EXTENSION_PATTERN))),
  }),
).pipe(
  Arbitrary.map(({ extension, owner, decoy }) =>
    ExplainFileSkipCommand.make({
      extension,
      claimants: [
        {
          package: owner,
          extensions: decoy === undefined ? [extension, extension] : [decoy, extension],
        },
      ],
    })
  ),
)

const strangerCommandArb = Arbitrary.schema(
  S.Struct({
    extension: S.String.check(S.isPattern(EXTENSION_PATTERN)),
    strangers: S.NonEmptyArray(
      S.Struct({
        package: S.String.check(S.isPattern(PACKAGE_PATTERN)),
        decoy: S.String.check(S.isPattern(EXTENSION_PATTERN)),
      }),
    ),
  }),
).pipe(
  Arbitrary.filter(({ extension, strangers }) => strangers.every(({ decoy }) => decoy !== extension)),
  Arbitrary.map(({ extension, strangers }) =>
    ExplainFileSkipCommand.make({
      extension,
      claimants: strangers.map(({ package: packageName, decoy }) => ({
        package: packageName,
        extensions: [decoy],
      })),
    })
  ),
)

const crowdCommandArb = Arbitrary.schema(
  S.Struct({
    extension: S.String.check(S.isPattern(EXTENSION_PATTERN)),
    first: S.String.check(S.isPattern(PACKAGE_PATTERN)),
    sleeper: S.String.check(S.isPattern(PACKAGE_PATTERN)),
    second: S.String.check(S.isPattern(PACKAGE_PATTERN)),
    last: S.String.check(S.isPattern(PACKAGE_PATTERN)),
  }),
).pipe(
  Arbitrary.map(({ extension, first, sleeper, second, last }) =>
    ExplainFileSkipCommand.make({
      extension,
      claimants: [
        { package: first, extensions: [extension] },
        { package: sleeper, extensions: [] },
        { package: second, extensions: [extension, extension] },
        { package: last, extensions: [extension] },
      ],
    })
  ),
)

describe('explainFileSkip', () => {
  it.prop('∀s_Solo_≡Known', { of: [soloCommandArb], subject: explainFileSkip }, (subject, [command]) => {
    const result = subject(command)
    if (Result.isFailure(result)) {
      return false
    }
    const owner = command.claimants.map((claimant) => claimant.package).join(', ')
    return (
      S.is(SkipKnownExplained)(result.success) &&
      result.success.extension === command.extension &&
      result.success.ownerPackage === owner &&
      result.success.reason === claimedReasonOf(command.extension, owner)
    )
  })

  it.prop('∀u_Stranger_≡Unknown', { of: [strangerCommandArb], subject: explainFileSkip }, (subject, [command]) => {
    const result = subject(command)
    if (Result.isFailure(result)) {
      return false
    }
    return (
      S.is(SkipUnknownExplained)(result.success) &&
      result.success.extension === command.extension &&
      result.success.reason === unclaimedReasonOf(command.extension)
    )
  })

  it.prop('∀m_Crowd_≡Order', { of: [crowdCommandArb], subject: explainFileSkip }, (subject, [command]) => {
    const result = subject(command)
    if (Result.isFailure(result)) {
      return false
    }
    const [first, , second, last] = command.claimants.map((claimant) => claimant.package)
    return (
      S.is(SkipKnownExplained)(result.success) &&
      result.success.extension === command.extension &&
      result.success.ownerPackage === first &&
      result.success.reason === claimedReasonOf(command.extension, `${first}, ${second}, ${last}`)
    )
  })
})
