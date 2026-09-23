import { describe, it } from '@effect/vitest'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ConfigFromFile,
  ConfigFromDefaults,
  ConfigOptionsRefused,
  LoadConfigCommand,
  resolveConfig,
} from '../run/resolve-config.workflow.js'

const optionsEquivalence = S.toEquivalence(StrykerOptionsSchema)

const variantIs = (fileFound: boolean) => (outcome: unknown) =>
  Boolean.match(fileFound, {
    onTrue: () => S.is(ConfigFromFile)(outcome),
    onFalse: () => S.is(ConfigFromDefaults)(outcome),
  })

describe('resolveConfig', () => {
  it.prop('∀c_Command_≡VariantFollowsFileFound', [LoadConfigCommand], ([command]) =>
    Result.match(resolveConfig(command), {
      onFailure: (refusal) => S.is(ConfigOptionsRefused)(refusal),
      onSuccess: variantIs(command.fileFound),
    }),
  )

  it.prop('∀o_OptionsRecord_≡MergedOptionsPreserved', [StrykerOptionsSchema, S.Boolean], ([options, fileFound]) =>
    Result.match(S.encodeResult(StrykerOptionsSchema)(options), {
      onFailure: () => false,
      onSuccess: (document) => {
        const expected = S.decodeResult(StrykerOptionsSchema)(document)
        const decision = resolveConfig(LoadConfigCommand.make({ document, fileFound }))
        return Result.match(expected, {
          onFailure: () => false,
          onSuccess: (decoded) =>
            Result.match(decision, {
              onFailure: () => false,
              onSuccess: (outcome) =>
                optionsEquivalence(outcome.options, decoded) && variantIs(fileFound)(outcome),
            }),
        })
      },
    }),
  )

  it.prop('∀c_Command_≡RefusalCarriesDecodeMessage', [LoadConfigCommand], ([command]) => {
    const decoded = S.decodeResult(StrykerOptionsSchema)(command.document)
    const decision = resolveConfig(command)
    return Result.match(decoded, {
      onFailure: (failure) =>
        Result.match(decision, {
          onFailure: (refusal) => S.is(ConfigOptionsRefused)(refusal) && refusal.message === failure.message,
          onSuccess: () => false,
        }),
      onSuccess: () => Result.isSuccess(decision),
    })
  })
})
