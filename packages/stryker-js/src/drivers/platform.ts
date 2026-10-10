import * as Layer from 'effect/Layer'

import type { EnginePorts } from '../run/StageServices.service.js'
import { makeNodePlatformLayer } from './node.js'
import { layer as reporterLayer } from './reporter.js'

export const makePlatformLayer = (options: {
  readonly childEnv: Readonly<Record<string, string>>
}): Layer.Layer<EnginePorts> => Layer.provideMerge(reporterLayer, makeNodePlatformLayer(options))

export const platformLayer: Layer.Layer<EnginePorts> = makePlatformLayer({ childEnv: {} })
