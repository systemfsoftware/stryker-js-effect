import { Framework, FrameworkFailed } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const refusal = new FrameworkFailed({
  reason: 'PeerVersionUnsupported',
  cause: 'svelte 3.20.0 is not supported (expected >=3.30)',
  peer: 'svelte',
  version: '3.20.0',
  supportedRange: '>=3.30',
})

export const strykerPlugins = [
  declarePlugin('Framework', 'peer-version-fixture', Layer.effect(Framework, Effect.fail(refusal))),
]
