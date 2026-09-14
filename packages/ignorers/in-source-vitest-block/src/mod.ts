import type { NodePath } from '@systemfsoftware/stryker-ignorer-interface'

import { ancestorsOf } from './AncestorWalk.js'
import { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard } from './InSourceTestIgnore.js'

const decisionAt = (ancestors: Iterable<unknown>): string | undefined => decideInSourceTestIgnore(ancestors)

const firstIgnoreReason = (path: NodePath): string | undefined => decisionAt(ancestorsOf(path))

export const strykerIgnorers = [{ name: 'in-source-vitest-block', shouldIgnore: firstIgnoreReason }]

export { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard }
