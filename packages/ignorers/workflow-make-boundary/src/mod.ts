import { ancestorsOf, type NodePath } from '@systemfsoftware/stryker-ignorer-interface'

import { AstNode } from './AstNode.schema.js'
import { decideWorkflowMakeBoundaryIgnore } from './MakeBoundaryIgnore.js'

const shouldIgnore = (path: NodePath): string | undefined =>
  decideWorkflowMakeBoundaryIgnore(path.node, [...ancestorsOf(path)])

export const strykerIgnorers = [{ name: 'workflow-make-boundary', schema: AstNode, shouldIgnore }]

export { decideWorkflowMakeBoundaryIgnore, NOT_INSIDE_WORKFLOW_MAKE } from './MakeBoundaryIgnore.js'
