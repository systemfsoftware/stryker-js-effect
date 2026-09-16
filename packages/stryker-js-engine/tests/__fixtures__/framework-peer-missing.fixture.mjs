import { Framework, FrameworkFailed } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const refusal = new FrameworkFailed({
  reason: 'PeerMissing',
  cause: 'the "svelte" peer is not installed',
  peer: 'svelte',
})

export const strykerPlugins = [
  declarePlugin('Framework', 'peer-missing-fixture', Layer.effect(Framework, Effect.fail(refusal))),
]
