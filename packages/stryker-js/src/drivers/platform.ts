import { Engine } from '@systemfsoftware/stryker-js-engine'
import { Reporting } from '@systemfsoftware/stryker-js-reporting'
import * as Layer from 'effect/Layer'
import { layer as engineIdentityLayer } from './engine-identity.js'

export const makePlatformLayer = (options: {
  readonly childEnv: Readonly<Record<string, string>>
}): Layer.Layer<Engine.EnginePorts> =>
  Layer.mergeAll(
    Layer.provideMerge(Reporting.layer, Engine.makeNodePlatformLayer(options)),
    engineIdentityLayer,
  )

export const platformLayer: Layer.Layer<Engine.EnginePorts> = makePlatformLayer({ childEnv: {} })
