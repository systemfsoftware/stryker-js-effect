import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'

import { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard } from './InSourceTestIgnore.js'

export const strykerIgnorers: readonly Ignorer[] = [
  { name: 'in-source-vitest-block', shouldIgnore: decideInSourceTestIgnore },
]

export { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard }
