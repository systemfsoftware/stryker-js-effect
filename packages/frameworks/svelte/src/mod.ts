import { Framework } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { peerLoader, resolveSvelteCompiler } from './compiler-resolution.js'
import { svelteFormatService } from './svelte-format.js'

const frameworkLayer = Layer.effect(
  Framework,
  Effect.gen(function*() {
    const load = yield* peerLoader
    return svelteFormatService(yield* resolveSvelteCompiler(load))
  }),
)

export const strykerPlugins = [declarePlugin('Framework', 'svelte', frameworkLayer)]
