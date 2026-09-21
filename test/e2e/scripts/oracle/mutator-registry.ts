export interface MutatorRegistryEntry {
  readonly contractSection: string
  readonly snippet: string
  readonly placementCount: number
  readonly replacements: readonly string[]
  readonly covered: boolean
}

export type MutatorRegistry = Readonly<Record<string, MutatorRegistryEntry>>

export const DECLARED_GAPS: Readonly<Record<string, true>> = Object.freeze({
  MethodExpression: true,
  Regex: true,
  UnaryOperator: true,
})

export const MUTATOR_REGISTRY: MutatorRegistry = Object.freeze({
  ArithmeticOperator: {
    contractSection: 'arithmeticoperator',
    snippet: 'const x = 1 + 2;',
    placementCount: 1,
    replacements: ['-'],
    covered: true,
  },
  ArrayDeclaration: {
    contractSection: 'arraydeclaration',
    snippet: 'const x = [1];',
    placementCount: 1,
    replacements: ['[]'],
    covered: true,
  },
  ArrowFunction: {
    contractSection: 'arrowfunction',
    snippet: 'const x = () => 1;',
    placementCount: 1,
    replacements: ['() => undefined'],
    covered: true,
  },
  AssignmentOperator: {
    contractSection: 'assignmentoperator',
    snippet: 'let x = 1; x += 2;',
    placementCount: 1,
    replacements: ['-='],
    covered: true,
  },
  BlockStatement: {
    contractSection: 'blockstatement',
    snippet: 'function f() { const x = 1; }',
    placementCount: 1,
    replacements: ['{}'],
    covered: true,
  },
  BooleanLiteral: {
    contractSection: 'booleanliteral',
    snippet: 'const x = true;',
    placementCount: 1,
    replacements: ['false'],
    covered: true,
  },
  ConditionalExpression: {
    contractSection: 'conditionalexpression',
    snippet: 'const x = a ? 1 : 2;',
    placementCount: 2,
    replacements: ['true', 'false'],
    covered: true,
  },
  EqualityOperator: {
    contractSection: 'equalityoperator',
    snippet: 'const x = a === b;',
    placementCount: 1,
    replacements: ['!=='],
    covered: true,
  },
  LogicalOperator: {
    contractSection: 'logicaloperator',
    snippet: 'const x = a && b;',
    placementCount: 1,
    replacements: ['||'],
    covered: true,
  },
  MethodExpression: {
    contractSection: 'methodexpression',
    snippet: 'const x = "HELLO".toLowerCase();',
    placementCount: 1,
    replacements: ['"HELLO".toUpperCase()'],
    covered: false,
  },
  ObjectLiteral: {
    contractSection: 'objectliteral',
    snippet: 'const x = { a: 1 };',
    placementCount: 1,
    replacements: ['{}'],
    covered: true,
  },
  OptionalChaining: {
    contractSection: 'optionalchaining',
    snippet: 'const x = a?.b;',
    placementCount: 1,
    replacements: ['.'],
    covered: true,
  },
  Regex: {
    contractSection: 'regex',
    snippet: 'const x = /a+/;',
    placementCount: 1,
    replacements: ['/a/'],
    covered: false,
  },
  StringLiteral: {
    contractSection: 'stringliteral',
    snippet: 'const x = "hello";',
    placementCount: 1,
    replacements: ['""'],
    covered: true,
  },
  UnaryOperator: {
    contractSection: 'unaryoperator',
    snippet: 'const x = -a;',
    placementCount: 1,
    replacements: ['+a'],
    covered: false,
  },
  UpdateOperator: {
    contractSection: 'updateoperator',
    snippet: 'let x = 1; x++;',
    placementCount: 1,
    replacements: ['--'],
    covered: true,
  },
})
