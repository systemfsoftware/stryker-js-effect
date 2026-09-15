import type { Node } from '@systemfsoftware/stryker-ignorer-interface'

function isTestNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
}

function node(type: string, extra: Record<string, unknown> = {}): Node {
  const candidate: unknown = { type, start: 0, end: 0, ...extra }
  if (!isTestNode(candidate)) throw new Error(`bad test node: ${type}`)
  return candidate
}

export function stringLiteral(value: string): Node {
  return node('Literal', { value, raw: null })
}

export function identifier(name: string): Node {
  return node('Identifier', { name })
}

export function callExpression(callee: Node, args: readonly Node[] = []): Node {
  return node('CallExpression', { callee, arguments: [...args] })
}

export function ifStatement(test: Node, consequent: Node): Node {
  return node('IfStatement', { test, consequent, alternate: null })
}
