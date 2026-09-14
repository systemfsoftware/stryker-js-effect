import { ancestorsOf, type NodePath } from '@systemfsoftware/stryker-ignorer-interface'

import { AstNode } from './AstNode.schema.js'
import { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard } from './InSourceTestIgnore.js'

const decisionAt = (ancestors: Iterable<unknown>): string | undefined => decideInSourceTestIgnore(ancestors)

const firstIgnoreReason = (path: NodePath): string | undefined => decisionAt(ancestorsOf(path))

export const strykerIgnorers = [{ name: 'in-source-vitest-block', schema: AstNode, shouldIgnore: firstIgnoreReason }]

export { decideInSourceTestIgnore, IN_SOURCE_TEST_IGNORED, isInSourceTestGuard }
