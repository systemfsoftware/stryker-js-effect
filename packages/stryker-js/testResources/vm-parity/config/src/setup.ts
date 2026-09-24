import { beforeEach } from 'vitest'

let setupHookRuns = 0

globalThis['setupMarker'] = 'setup ran'

beforeEach(() => {
  setupHookRuns += 1
  globalThis['setupHookRuns'] = setupHookRuns
})
