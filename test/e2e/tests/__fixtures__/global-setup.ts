import { Cause, Effect, Exit } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'

import { BAKED_ROOT_ENV, bakeFixtureCache } from './microvm-environment.js'

export default async function setup(): Promise<void> {
  const exit = await Effect.runPromiseExit(bakeFixtureCache.pipe(Effect.provide(nodeServicesLayer)))
  const bakedRoot: string = Exit.match(exit, {
    onSuccess: (root) => root,
    onFailure: (cause) => {
      throw new Error(Cause.pretty(cause))
    },
  })
  process.env[BAKED_ROOT_ENV] = bakedRoot
}
