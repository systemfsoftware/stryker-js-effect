import { Framework, FrameworkFailed } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const refusal = new FrameworkFailed({
  reason: 'InvalidContribution',
  cause: 'the "angular-html-parser/package.json" hard dependency is not resolvable',
})

export const strykerPlugins = [
  declarePlugin('Framework', 'refused-fixture', Layer.effect(Framework, Effect.fail(refusal))),
]
