import { runMain } from '@effect/platform-node/NodeRuntime'
import { layer } from '@effect/platform-node/NodeServices'
import { Effect } from 'effect'

import { BakedFixtureCache } from '../src/Harness/fixture-cache.service.js'

runMain(BakedFixtureCache.lockProgram.pipe(Effect.provide(layer)))
