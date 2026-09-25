import type { ViteUserConfig } from '@systemfsoftware/vitest-config'

import base from './vitest.config.js'

export default base.then((config): ViteUserConfig => ({
  ...config,
  test: {
    ...config.test,
    include: ['src/**/__tests__/*.test.ts'],
  },
}))
