import { layer } from '@systemfsoftware/vitest'

import { memoryVerdictStoreLayer } from '../drivers/memory-verdict-store.js'
import { registerVerdictStoreLaws } from '../verdict-store/laws.js'

layer(memoryVerdictStoreLayer)('memory verdict store', (it) => {
  registerVerdictStoreLaws((name, spec, holds) => it.effect.prop(name, spec, holds))
})
