import { Differential, Metamorphic } from '@systemfsoftware/differential-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as Effect from 'effect/Effect'
import * as fc from 'fast-check'
import { Project } from 'ts-morph'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import {
  dualizeBooleanArithmetic,
  injectDeadCode,
  injectDisableNextLine,
  nestSubsumingExpressions,
  shuffleIndependentStatements,
} from './oracle/metamorphic.js'
import type { IndependentInventory } from './oracle/types.js'

const RESERVED_WORDS: Readonly<Record<string, true>> = {
  'do': true,
  'if': true,
  'in': true,
  'for': true,
  'let': true,
  'new': true,
  'try': true,
  'var': true,
  'case': true,
  'else': true,
  'enum': true,
  'eval': true,
  'null': true,
  'this': true,
  'true': true,
  'void': true,
  'with': true,
  'await': true,
  'break': true,
  'catch': true,
  'class': true,
  'const': true,
  'false': true,
  'super': true,
  'throw': true,
  'while': true,
  'yield': true,
  'delete': true,
  'export': true,
  'import': true,
  'public': true,
  'return': true,
  'static': true,
  'switch': true,
  'typeof': true,
  'default': true,
  'extends': true,
  'finally': true,
  'package': true,
  'private': true,
  'continue': true,
  'debugger': true,
  'function': true,
  'arguments': true,
  'interface': true,
  'protected': true,
  'implements': true,
  'instanceof': true,
}

type BinaryOperator = '===' | '!==' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/'
type CompoundOperator = '+=' | '-=' | '*=' | '/='
type LogicalAssignOperator = '&&=' | '||=' | '??='
type LiteralValue = number | boolean | string

type Statement =
  | readonly ['assign', string, LiteralValue]
  | readonly ['binary', string, string, BinaryOperator, LiteralValue]
  | readonly ['conditional', string, LiteralValue, LiteralValue]
  | readonly ['compound', string, CompoundOperator, LiteralValue]
  | readonly ['logical', string, LogicalAssignOperator, LiteralValue]
  | readonly ['optional', string, string, string]
  | readonly ['object', string, LiteralValue, LiteralValue]
  | readonly ['class', string, LiteralValue]
  | readonly ['function', string]

const identifiersOf = (statement: Statement): ReadonlyArray<string> => {
  switch (statement[0]) {
    case 'assign':
      return [statement[1]]
    case 'binary':
      return [statement[1], statement[2]]
    case 'conditional':
      return [statement[1]]
    case 'compound':
      return [statement[1]]
    case 'logical':
      return [statement[1]]
    case 'optional':
      return [statement[1], statement[2], statement[3]]
    case 'object':
      return [statement[1]]
    case 'class':
      return [statement[1]]
    case 'function':
      return [statement[1]]
  }
}

const renderLiteral = (value: LiteralValue): string =>
  typeof value === 'boolean' || typeof value === 'number' ? String(value) : JSON.stringify(value)

const renderStatement = (statement: Statement): string => {
  switch (statement[0]) {
    case 'assign':
      return `const ${statement[1]} = ${renderLiteral(statement[2])};`
    case 'binary':
      return `const ${statement[1]} = ${statement[2]} ${statement[3]} ${renderLiteral(statement[4])};`
    case 'conditional':
      return `const ${statement[1]} = (${statement[1]} !== null) ? ${renderLiteral(statement[2])} : ${
        renderLiteral(statement[3])
      };`
    case 'compound':
      return `let mutable_${statement[1]} = 0; mutable_${statement[1]} ${statement[2]} ${renderLiteral(statement[3])};`
    case 'logical':
      return `let logical_${statement[1]} = true; logical_${statement[1]} ${statement[2]} ${
        renderLiteral(statement[3])
      };`
    case 'optional':
      return `const ${statement[1]} = ${statement[2]}?.${statement[3]} ?? ${statement[2]}?.[0] ?? ${statement[2]}?.();`
    case 'object':
      return `const obj_${statement[1]} = { a: ${renderLiteral(statement[2])}, b: [${renderLiteral(statement[3])}] };`
    case 'class':
      return `class Cls_${statement[1]} { #secret = ${
        renderLiteral(statement[2])
      }; get secret() { return this.#secret; } }`
    case 'function':
      return `function fn_${statement[1]}(x: number) { let count = x; count++; return --count; }`
  }
}

const AST_MATCHED_FAMILIES = [
  'BlockStatement',
  'EqualityOperator',
  'ArithmeticOperator',
  'AssignmentOperator',
  'LogicalOperator',
  'StringLiteral',
  'BooleanLiteral',
  'ArrayDeclaration',
  'ObjectLiteral',
  'UpdateOperator',
  'OptionalChaining',
]

const lowercaseLetter = fc.integer({ min: 97, max: 122 }).map((code) => String.fromCharCode(code))

const identifierTailChar = fc
  .oneof(
    fc.integer({ min: 97, max: 122 }),
    fc.integer({ min: 65, max: 90 }),
    fc.integer({ min: 48, max: 57 }),
    fc.integer({ min: 95, max: 95 }),
  )
  .map((code) => String.fromCharCode(code))

const identifierRaw = fc
  .tuple(lowercaseLetter, fc.array(identifierTailChar, { maxLength: 8 }))
  .map(([head, tail]) => `${head}${tail.join('')}`)

const identifier = identifierRaw.filter((name) => RESERVED_WORDS[name] === undefined)

const printableChar = fc.integer({ min: 32, max: 126 }).map((code) => String.fromCharCode(code))
const literalString = fc.array(printableChar, { maxLength: 8 }).map((chars) => chars.join(''))

const boundedInteger = fc.integer({ min: -100, max: 100 })
const positiveHundred = fc.integer({ min: 1, max: 100 })
const positiveFifty = fc.integer({ min: 1, max: 50 })

const literalRaw: fc.Arbitrary<LiteralValue> = fc.oneof(boundedInteger, fc.boolean(), literalString)
const literal = literalRaw.map(renderLiteral)

const statementRaw: fc.Arbitrary<Statement> = fc.oneof(
  fc.tuple(fc.constant('assign'), identifierRaw, literalRaw),
  fc.tuple(
    fc.constant('binary'),
    identifierRaw,
    identifierRaw,
    fc.constantFrom<BinaryOperator>('===', '!==', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/'),
    literalRaw,
  ),
  fc.tuple(fc.constant('conditional'), identifierRaw, literalRaw, literalRaw),
  fc.tuple(
    fc.constant('compound'),
    identifierRaw,
    fc.constantFrom<CompoundOperator>('+=', '-=', '*=', '/='),
    literalRaw,
  ),
  fc.tuple(
    fc.constant('logical'),
    identifierRaw,
    fc.constantFrom<LogicalAssignOperator>('&&=', '||=', '??='),
    literalRaw,
  ),
  fc.tuple(fc.constant('optional'), identifierRaw, identifierRaw, identifierRaw),
  fc.tuple(fc.constant('object'), identifierRaw, literalRaw, literalRaw),
  fc.tuple(fc.constant('class'), identifierRaw, literalRaw),
  fc.tuple(fc.constant('function'), identifierRaw),
)

const statement = statementRaw
  .filter((candidate) => identifiersOf(candidate).every((name) => RESERVED_WORDS[name] === undefined))
  .map(renderStatement)

const sourceCode = fc.array(statement, { minLength: 1, maxLength: 6 }).map((statements) => statements.join('\n'))

const excludedFamilies = fc
  .array(fc.boolean(), { minLength: AST_MATCHED_FAMILIES.length, maxLength: AST_MATCHED_FAMILIES.length })
  .map((mask) => AST_MATCHED_FAMILIES.filter((_family, index) => mask[index] === true))
  .filter((families) => families.length > 0)

const reachableStatement = fc.tuple(identifier, literal).map(([name, value]) => `const ${name} = ${value};`)

const independentDeclaration = fc
  .tuple(identifier, literal)
  .map(([name, value]) => `const const_${name} = ${value};`)

const independentPair = fc.tuple(independentDeclaration, independentDeclaration)

const dualityInput = fc.tuple(identifier, fc.constantFrom<'&&' | '||'>('&&', '||'), identifier)

const targetStatement = fc.tuple(identifier, positiveHundred).map(([name, value]) => `const ${name} = ${value} + 1;`)

const surroundingStatement = fc
  .tuple(identifier, positiveHundred)
  .map(([name, value]) => `const post_${name} = ${value} + 2;`)

const subsumptionInput = fc.tuple(positiveFifty, positiveFifty, positiveFifty, positiveFifty)

const FLAT_ARITHMETIC_PLACEMENTS = 2

const analyzeCode = (code: string, excluded: ReadonlyArray<string> = []): IndependentInventory =>
  analyzeFileWithTsMorph(code, excluded)

const countOfFamily = (mutants: ReadonlyArray<{ readonly mutatorName: string }>, family: string): number =>
  mutants.filter((mutant) => mutant.mutatorName === family).length

function alphaRename(sourceText: string, suffix: string): string {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile('alpha.ts', sourceText)

  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const name = varDecl.getName()
    if (!name.startsWith('mutable_') && !name.startsWith('obj_') && !name.startsWith('logical_')) {
      varDecl.rename(`${name}_${suffix}`)
    }
  }

  return sourceFile.getFullText()
}

const instrumentOxcCode = (code: string) =>
  Instrument.instrument([{ name: 'synthetic.ts', content: code, mutate: true }], {
    excludedMutations: [],
    ignorers: [],
  })

const INSTRUMENTER_HOST_BOUND = {
  timeout: 120_000,
  reason:
    'the oxc instrumenter runs an asynchronous Effect runtime — scopes and async finalizers the simulation kernel cannot schedule',
} as const

const analyse = (code: string): Effect.Effect<IndependentInventory> => Effect.sync(() => analyzeCode(code))

const tallyIsInvariant = (baseline: IndependentInventory, renamed: IndependentInventory): boolean =>
  baseline.mutants.length === renamed.mutants.length &&
  Object.entries(baseline.mutatorTally).every(([mutator, count]) => renamed.mutatorTally[mutator] === count)

Metamorphic.on({
  name: 'Metamorphic Invariant 1: α-Conversion Invariance — total and tally are invariant under variable renaming',
  system: analyse,
})
  .relation({
    transformInput: (code) => alphaRename(code, 'renamed'),
    assertOutput: tallyIsInvariant,
  })
  .on(sourceCode, { runBudget: 300 })

const subtractionInput = fc.tuple(sourceCode, excludedFamilies).map(([code, excluded]) => ({ code, excluded }))

Metamorphic.on({
  name: 'Metamorphic Invariant 2: Monotonic Subtraction — excluded mutators leave active and join ignored',
  system: (input: { readonly code: string; readonly excluded: ReadonlyArray<string> }) =>
    Effect.sync(() => ({ inventory: analyzeCode(input.code, input.excluded), excluded: input.excluded })),
})
  .relation({
    transformInput: (input) => ({ code: input.code, excluded: [] }),
    assertOutput: (withExclusions, baseline) => {
      if (withExclusions.inventory.mutants.length !== baseline.inventory.mutants.length) {
        return false
      }

      const expectedActiveDrop = withExclusions.excluded.reduce(
        (total, mutator) => total + (baseline.inventory.mutatorTally[mutator] ?? 0),
        0,
      )

      return baseline.inventory.activeCount - withExclusions.inventory.activeCount === expectedActiveDrop &&
        withExclusions.inventory.ignoredCount - baseline.inventory.ignoredCount === expectedActiveDrop
    },
  })
  .on(subtractionInput, { runBudget: 300 })

Differential.compare({
  name: 'Differential Equivalence 3: oxc and ts-morph agree on every shared mutator family',
  reference: (code: string) => Effect.sync(() => analyzeFileWithTsMorph(code, [])),
  candidate: instrumentOxcCode,
})
  .on(sourceCode, { runBudget: 200, hostBound: INSTRUMENTER_HOST_BOUND })
  .assert((tsMorph, oxc) =>
    AST_MATCHED_FAMILIES.every(
      (family) => countOfFamily(oxc.mutants, family) === countOfFamily(tsMorph.mutants, family),
    )
  )

const arithmeticTally = (inventory: IndependentInventory): number => inventory.mutatorTally['ArithmeticOperator'] ?? 0

Metamorphic.on({
  name: 'Metamorphic Invariant 8a: Dead-Code Invariance — enabled dead code adds one active arithmetic placement',
  system: analyse,
})
  .relation({
    transformInput: (statement) => injectDeadCode(statement).transformedSource,
    assertOutput: (baseline, dead) => arithmeticTally(dead) - arithmeticTally(baseline) === 1,
  })
  .on(reachableStatement, { runBudget: 200 })

Metamorphic.on({
  name: 'Metamorphic Invariant 8b: Dead-Code Invariance — disabled dead code is ignored, never active',
  system: analyse,
})
  .relation({
    transformInput: (statement) => injectDeadCode(statement, { disabled: true }).transformedSource,
    assertOutput: (baseline, disabled) => disabled.ignoredCount > baseline.ignoredCount,
  })
  .on(reachableStatement, { runBudget: 200 })

Metamorphic.on({
  name: 'Metamorphic Invariant 9: Statement Commutativity — independent statement order leaves the tally identical',
  system: (statements: ReadonlyArray<string>) => Effect.sync(() => analyzeCode(statements.join('\n'))),
})
  .relation({
    transformInput: (statements) => shuffleIndependentStatements(statements).shuffled,
    assertOutput: tallyIsInvariant,
  })
  .on(independentPair, { runBudget: 200 })

const dualityRelationInput = dualityInput.map(([left, op, right]) => ({ left, op, right, dualized: false }))

type DualityRelationInput = {
  readonly left: string
  readonly op: '&&' | '||'
  readonly right: string
  readonly dualized: boolean
}

Metamorphic.on({
  name: 'Metamorphic Invariant 10: Boolean & Arithmetic Duality — De Morgan duality preserves the tally contract',
  system: (input: DualityRelationInput) =>
    Effect.sync(() => {
      const contract = dualizeBooleanArithmetic(input.left, input.op, input.right)
      const expression = input.dualized ? contract.dualExpr : contract.originalExpr
      return { inventory: analyzeCode(`const _b = ${expression};`), contract }
    }),
})
  .relation({
    transformInput: (input) => ({ ...input, dualized: !input.dualized }),
    assertOutput: (original, dual) => {
      const origLogical = original.inventory.mutatorTally['LogicalOperator'] ?? 0
      const dualLogical = dual.inventory.mutatorTally['LogicalOperator'] ?? 0
      const dualBool = dual.inventory.mutatorTally['BooleanLiteral'] ?? 0

      return origLogical === original.contract.originalLogicalCount &&
        dualLogical === dual.contract.dualLogicalCount &&
        dualBool >= dual.contract.dualPrefixBangCount
    },
  })
  .on(dualityRelationInput, { runBudget: 200 })

const directiveInput = fc
  .tuple(targetStatement, surroundingStatement)
  .map(([target, after]) => ({ target, after, source: `${target}\n${after}` }))

type DirectiveInput = {
  readonly target: string
  readonly after: string
  readonly source: string
}

Metamorphic.on({
  name: 'Metamorphic Invariant 11: Directive Scope Invariance — disable next-line mutes exactly the next line',
  system: (input: DirectiveInput) => Effect.sync(() => analyzeCode(input.source)),
})
  .relation({
    transformInput: (input: DirectiveInput) => ({
      ...input,
      source: injectDisableNextLine(input.target, [], [input.after], true),
    }),
    assertOutput: (baseline, disabled) => {
      const targetActiveBefore = baseline.mutants.some((mutant) => mutant.status === 'Active' && mutant.line === 1)
      const targetIgnored = disabled.mutants.some((mutant) => mutant.status === 'Ignored' && mutant.line === 2)
      const afterActive = disabled.mutants.some((mutant) => mutant.status === 'Active' && mutant.line === 4)

      return targetActiveBefore && targetIgnored && afterActive
    },
  })
  .on(directiveInput, { runBudget: 200 })

const subsumptionRelationInput = subsumptionInput.map(([a, b, c, d]) => ({
  left: { left: a, op: '+', right: b },
  right: { left: c, op: '+', right: d },
  nested: false,
}))

type SubsumptionRelationInput = {
  readonly left: { readonly left: number; readonly op: string; readonly right: number }
  readonly right: { readonly left: number; readonly op: string; readonly right: number }
  readonly nested: boolean
}

Metamorphic.on({
  name: 'Metamorphic Invariant 12: Mutation Subsumption bounded — nesting places every declared arithmetic mutant',
  system: (input: SubsumptionRelationInput) =>
    Effect.sync(() => {
      const nested = nestSubsumingExpressions(input.left, '*', input.right)
      const flat =
        `const _flatLeft = (${input.left.left} ${input.left.op} ${input.left.right});\nconst _flatRight = (${input.right.left} ${input.right.op} ${input.right.right});`
      return {
        inventory: analyzeCode(input.nested ? nested.sourceCode : flat),
        expected: input.nested ? nested.totalArithmeticPlacements : FLAT_ARITHMETIC_PLACEMENTS,
      }
    }),
})
  .relation({
    transformInput: (input) => ({ ...input, nested: !input.nested }),
    assertOutput: (flat, nested) =>
      countOfFamily(flat.inventory.mutants, 'ArithmeticOperator') === flat.expected &&
      countOfFamily(nested.inventory.mutants, 'ArithmeticOperator') === nested.expected,
  })
  .on(subsumptionRelationInput, { runBudget: 200 })
