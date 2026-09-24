import { describe, it } from '@effect/vitest'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ConfigFromDefaults,
  ConfigFromFile,
  ConfigOptionsRefused,
  LoadConfigCommand,
  type LoadConfigDecision,
  resolveConfig,
} from '../run/resolve-config.workflow.js'

const variantIs = (fileFound: boolean) => (outcome: LoadConfigDecision) =>
  Boolean.match(fileFound, {
    onTrue: () => S.is(ConfigFromFile)(outcome),
    onFalse: () => S.is(ConfigFromDefaults)(outcome),
  })

describe('resolveConfig', () => {
  it.prop(
    '∀c_Command_≡VariantFollowsFileFound',
    [LoadConfigCommand],
    ([command]) =>
      Result.match(resolveConfig(command), {
        onFailure: (refusal) => S.is(ConfigOptionsRefused)(refusal),
        onSuccess: variantIs(command.fileFound),
      }),
  )
})
