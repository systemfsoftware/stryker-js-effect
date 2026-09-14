import type { NodePath } from '@systemfsoftware/stryker-ignorer-interface'

import { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard } from './InSourceTestIgnore.js'

const firstIgnoreReason = (path: NodePath): string | undefined => decideInSourceTestIgnore(path.ancestors)

export const strykerIgnorers = [{ name: 'in-source-vitest-block', shouldIgnore: firstIgnoreReason }]

export { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard }
