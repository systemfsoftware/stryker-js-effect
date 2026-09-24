import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CrowdCase, SoloCase, StrangerCase } from '../../tests/__fixtures__/explain-file-skip.schema.js'
import {
  explainFileSkip,
  ExplainFileSkipCommand,
  FileSkipDecision,
  SkipKnownExplained,
  SkipUnknownExplained,
} from '../run/explain-file-skip.workflow.js'
const ExplainFileSkipTypeId = Symbol.for('@systemfsoftware/stryker-js/ExplainFileSkipDecision')

const claimedReasonOf = (extension: string, joined: string): string =>
  `No loaded framework claims "${extension}". Add ${joined} to "plugins" to instrument it.`

const unclaimedReasonOf = (extension: string): string =>
  `No loaded framework claims "${extension}". No installed package declares it as a framework plugin: install the framework plugin that claims this file type and add it to "plugins" to instrument it.`

const hasBrand = (decision: FileSkipDecision): boolean =>
  Object.getOwnPropertySymbols(decision).includes(ExplainFileSkipTypeId)

describe('explainFileSkip', () => {
  it.prop('∀d_Brand_∈Decision', [FileSkipDecision], ([decision]) => hasBrand(decision))

  it.prop('∀s_Solo_≡Known', [SoloCase], ([input]) => {
    const command = ExplainFileSkipCommand.make({
      extension: input.extension,
      claimants: [
        {
          package: input.owner,
          extensions: input.decoyExtensions === undefined
            ? [input.extension, input.extension]
            : [input.decoyExtensions, input.extension],
        },
      ],
    })
    const result = explainFileSkip(command)
    if (Result.isFailure(result)) {
      return false
    }
    return (
      S.is(SkipKnownExplained)(result.success) &&
      result.success.extension === input.extension &&
      result.success.ownerPackage === input.owner &&
      result.success.reason === claimedReasonOf(input.extension, input.owner)
    )
  })

  it.prop('∀u_Stranger_≡Unknown', [StrangerCase], ([input]) => {
    const command = ExplainFileSkipCommand.make({
      extension: input.extension,
      claimants: input.strangers
        .filter((stranger) => stranger.decoy !== input.extension)
        .map((stranger) => ({ package: stranger.package, extensions: [stranger.decoy] })),
    })
    const result = explainFileSkip(command)
    if (Result.isFailure(result)) {
      return false
    }
    return (
      S.is(SkipUnknownExplained)(result.success) &&
      result.success.extension === input.extension &&
      result.success.reason === unclaimedReasonOf(input.extension)
    )
  })

  it.prop('∀m_Crowd_≡Order', [CrowdCase], ([input]) => {
    const command = ExplainFileSkipCommand.make({
      extension: input.extension,
      claimants: [
        { package: input.first, extensions: [input.extension] },
        { package: input.sleeper, extensions: ['.zzz'] },
        { package: input.second, extensions: [input.extension, input.extension] },
        { package: input.last, extensions: [input.extension] },
      ],
    })
    const result = explainFileSkip(command)
    if (Result.isFailure(result)) {
      return false
    }
    return (
      S.is(SkipKnownExplained)(result.success) &&
      result.success.extension === input.extension &&
      result.success.ownerPackage === input.first &&
      result.success.reason === claimedReasonOf(input.extension, `${input.first}, ${input.second}, ${input.last}`)
    )
  })
})
