import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { describe } from '@systemfsoftware/vitest'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'
import * as fs from 'node:fs'
import { Project } from 'ts-morph'
import { defaultMutators } from '../../../packages/stryker-js-instrumenter/src/Mutator.service.js'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import { determineCompileErrorsWithDiagnostics } from './oracle/diagnostics.js'
import {
  dualizeBooleanArithmetic,
  injectDeadCode,
  injectDisableNextLine,
  nestSubsumingExpressions,
  shuffleIndependentStatements,
} from './oracle/metamorphic.js'
import { DECLARED_GAPS, MUTATOR_REGISTRY } from './oracle/mutator-registry.js'
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

const IDENTIFIER_PATTERN = /^[a-z][a-zA-Z0-9_]{0,8}$/

const IdentifierSchema = S.String.check(S.isPattern(IDENTIFIER_PATTERN))
const Identifier = Arbitrary.schema(IdentifierSchema).pipe(
  Arbitrary.filter((identifier) => RESERVED_WORDS[identifier] === undefined),
)

const BinaryOperator = S.Literals(['===', '!==', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/'])

const CompoundOperator = S.Literals(['+=', '-=', '*=', '/='])
const LogicalAssignOperator = S.Literals(['&&=', '||=', '??='])

const BoundedInteger = S.Int.check(S.isBetween({ minimum: -100, maximum: 100 }))
const PositiveHundred = S.Int.check(S.isBetween({ minimum: 1, maximum: 100 }))
const PositiveFifty = S.Int.check(S.isBetween({ minimum: 1, maximum: 50 }))

const LiteralSchema = S.Union([BoundedInteger, S.Boolean, S.String.check(S.isMaxLength(8))])
type LiteralValue = typeof LiteralSchema.Type

const renderLiteral = (value: LiteralValue): string =>
  typeof value === 'boolean' || typeof value === 'number' ? String(value) : JSON.stringify(value)

const Literal = Arbitrary.schema(LiteralSchema).pipe(Arbitrary.map(renderLiteral))

const StatementSchema = S.Union([
  S.Tuple([S.Literals(['assign']), IdentifierSchema, LiteralSchema]),
  S.Tuple([S.Literals(['binary']), IdentifierSchema, IdentifierSchema, BinaryOperator, LiteralSchema]),
  S.Tuple([S.Literals(['conditional']), IdentifierSchema, LiteralSchema, LiteralSchema]),
  S.Tuple([S.Literals(['compound']), IdentifierSchema, CompoundOperator, LiteralSchema]),
  S.Tuple([S.Literals(['logical']), IdentifierSchema, LogicalAssignOperator, LiteralSchema]),
  S.Tuple([S.Literals(['optional']), IdentifierSchema, IdentifierSchema, IdentifierSchema]),
  S.Tuple([S.Literals(['object']), IdentifierSchema, LiteralSchema, LiteralSchema]),
  S.Tuple([S.Literals(['class']), IdentifierSchema, LiteralSchema]),
  S.Tuple([S.Literals(['function']), IdentifierSchema]),
])
type Statement = typeof StatementSchema.Type

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

const StatementArbitrary = Arbitrary.schema(StatementSchema).pipe(
  Arbitrary.filter((statement) =>
    identifiersOf(statement).every((identifier) => RESERVED_WORDS[identifier] === undefined)
  ),
  Arbitrary.map(renderStatement),
)

const SourceCode = Arbitrary.array(StatementArbitrary, { minLength: 1, maxLength: 6 }).pipe(
  Arbitrary.map((statements) => statements.join('\n')),
)

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

const FamilyMask = S.Tuple(AST_MATCHED_FAMILIES.map(() => S.Boolean))

const ExcludedFamilies = Arbitrary.schema(FamilyMask).pipe(
  Arbitrary.map((mask) => AST_MATCHED_FAMILIES.filter((_family, index) => mask[index] === true)),
  Arbitrary.filter((families) => families.length > 0),
)

const ReachableStatement = Arbitrary.all([Identifier, Literal]).pipe(
  Arbitrary.map(([identifier, literal]) => `const ${identifier} = ${literal};`),
)

const IndependentDeclaration = Arbitrary.all([Identifier, Literal]).pipe(
  Arbitrary.map(([identifier, literal]) => `const const_${identifier} = ${literal};`),
)

const IndependentPair = Arbitrary.all([IndependentDeclaration, IndependentDeclaration])

const DualityInput = Arbitrary.all([Identifier, Arbitrary.schema(S.Literals(['&&', '||'])), Identifier])

const TargetStatement = Arbitrary.all([Identifier, Arbitrary.schema(PositiveHundred)]).pipe(
  Arbitrary.map(([identifier, value]) => `const ${identifier} = ${value} + 1;`),
)

const SurroundingStatement = Arbitrary.all([Identifier, Arbitrary.schema(PositiveHundred)]).pipe(
  Arbitrary.map(([identifier, value]) => `const post_${identifier} = ${value} + 2;`),
)

const SubsumptionInput = S.Tuple([PositiveFifty, PositiveFifty, PositiveFifty, PositiveFifty])

const snippet = (code: string, family: string, expectedReplacement: string) =>
  S.Struct({
    code: S.Literals([code]),
    family: S.Literals([family]),
    expectedReplacement: S.Literals([expectedReplacement]),
  })

const ReplaceableSnippet = S.Union([
  snippet('const s = "HELLO".toLowerCase();', 'MethodExpression', '"HELLO".toUpperCase()'),
  snippet('const s = "hello".toUpperCase();', 'MethodExpression', '"hello".toLowerCase()'),
  snippet('const a = arr.filter(x => x);', 'MethodExpression', 'arr()'),
  snippet('const r = /a+/;', 'Regex', '/a/'),
  snippet('const r = /\\d/;', 'Regex', '/\\D/'),
  snippet('const r = /^abc$/;', 'Regex', '/abc$/'),
  snippet('const u = +a;', 'UnaryOperator', '-a'),
  snippet('const u = -a;', 'UnaryOperator', '+a'),
  snippet('const u = ~a;', 'UnaryOperator', 'a'),
  snippet('const b = !a;', 'BooleanLiteral', 'a'),
  snippet('const b = !isReady;', 'BooleanLiteral', 'isReady'),
])

const OptionalChainingSnippet = S.Literals(['const o = a?.b;', 'const o = a?.[0];', 'const o = a?.();'])

const analyzeCode = (code: string, excluded: ReadonlyArray<string> = []): IndependentInventory =>
  analyzeFileWithTsMorph(code, excluded)

const countOfFamily = (mutants: ReadonlyArray<{ readonly mutatorName: string }>, family: string): number =>
  mutants.filter((mutant) => mutant.mutatorName === family).length

const coveredFamilies = (
  registry: Readonly<Record<string, { readonly covered: boolean }>>,
): Readonly<Record<string, true>> => {
  const covered: Record<string, true> = {}
  for (const [name, entry] of Object.entries(registry)) {
    if (entry.covered) covered[name] = true
  }
  return covered
}

const checkFamilyExhaustiveness = (
  family: string,
  covered: Readonly<Record<string, true>>,
  declaredGaps: Readonly<Record<string, true>>,
): boolean => {
  if (covered[family] !== true && declaredGaps[family] !== true) {
    throw new Error(`Uncovered and undeclared mutator family in registry: ${family}`)
  }
  return true
}

const stubRegistry: Record<string, unknown> = {
  ...defaultMutators,
  SyntheticMutator: () => [],
}
const stubCovered = coveredFamilies(MUTATOR_REGISTRY)

const contractContent = fs.readFileSync(new URL('./oracle/mutator-contract.md', import.meta.url), 'utf-8')

const contractHeadingFor = (family: string): string | undefined => {
  const entry = MUTATOR_REGISTRY[family]
  if (entry === undefined) {
    return undefined
  }
  const anchor = entry.contractSection.replace(/^#/, '')
  const headingRegex = new RegExp(`^#{2,3}\\s+.*\\b(${family}|${anchor})\\b`, 'm')
  return headingRegex.exec(contractContent)?.[0]
}

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

describe('SOTA Metamorphic & Differential Oracle Properties', (it) => {
  it.prop(
    'Metamorphic Invariant 1: α-Conversion Invariance (Total & Tally are invariant under variable renaming)',
    { of: [SourceCode], subject: analyzeCode, runs: 300 },
    (subject, [code]) => {
      const baseline = subject(code)
      const renamed = subject(alphaRename(code, 'renamed'))

      if (baseline.mutants.length !== renamed.mutants.length) {
        return false
      }

      return Object.entries(baseline.mutatorTally).every(([mutator, count]) => renamed.mutatorTally[mutator] === count)
    },
  )

  it.prop(
    'Metamorphic Invariant 2: Monotonic Subtraction (Excluded mutators strictly subtract from active)',
    { of: [SourceCode, ExcludedFamilies], subject: analyzeCode, runs: 300 },
    (subject, [code, excluded]) => {
      const baseline = subject(code)
      const withExclusions = subject(code, excluded)

      if (withExclusions.mutants.length !== baseline.mutants.length) {
        return false
      }

      const expectedActiveDrop = excluded.reduce((total, mutator) => total + (baseline.mutatorTally[mutator] ?? 0), 0)

      return baseline.activeCount - withExclusions.activeCount === expectedActiveDrop &&
        withExclusions.ignoredCount - baseline.ignoredCount === expectedActiveDrop
    },
  )

  it.effect.prop(
    'Differential Equivalence 3: oxc vs ts-morph Differential Agreement across all shared mutators',
    { of: [SourceCode], subject: instrumentOxcCode, runs: 200 },
    (subject, [code]) =>
      Effect.gen(function*() {
        const oxc = yield* subject(code)
        const tsMorph = analyzeFileWithTsMorph(code, [])

        return AST_MATCHED_FAMILIES.every((family) =>
          countOfFamily(oxc.mutants, family) === countOfFamily(tsMorph.mutants, family)
        )
      }),
  )

  it.effect.prop(
    'Differential Equivalence 3b (R3 staged): single-mutant replacements and replacement spans',
    { of: [ReplaceableSnippet], subject: instrumentOxcCode, runs: 100 },
    (subject, [chosen]) =>
      Effect.gen(function*() {
        const oxc = yield* subject(chosen.code)
        const tsMorph = analyzeFileWithTsMorph(chosen.code, [])
        const oxcMutants = oxc.mutants.filter((mutant) => mutant.mutatorName === chosen.family)
        const tsMorphMutants = tsMorph.mutants.filter((mutant) => mutant.mutatorName === chosen.family)

        if (oxcMutants.length !== tsMorphMutants.length) {
          return false
        }

        const only = tsMorphMutants.length === 1 ? tsMorphMutants[0] : undefined
        return only === undefined || only.replacement === chosen.expectedReplacement
      }),
  )

  it.prop(
    'Differential Equivalence 3b (R3 staged): OptionalChaining replacement spans stay within the question-dot',
    { of: [OptionalChainingSnippet], subject: analyzeCode, runs: 100 },
    (subject, [code]) => {
      const optMutants = subject(code).mutants.filter((mutant) => mutant.mutatorName === 'OptionalChaining')
      const only = optMutants.length === 1 ? optMutants[0] : undefined

      return only !== undefined && ['.', '[', '('].includes(only.replacement)
    },
  )

  it.prop(
    'A Priori Semantic Invariant 4: CompileError classification matches ts.getPreEmitDiagnostics',
    {
      of: [S.Literals([[
        'export const calculate = (x: number): number => {',
        '  if (x > 0) {',
        '    return x + 1;',
        '  }',
        '  return 0;',
        '};',
        'export const getMessage = async (): Promise<string> => {',
        '  return "hello";',
        '};',
      ].join('\n')])],
      subject: analyzeCode,
      runs: 100,
    },
    (subject, [code]) => {
      const withDiagnostics = determineCompileErrorsWithDiagnostics(code, subject(code).mutants)

      const emptyBlockMutant = withDiagnostics.find(
        (mutant) => mutant.mutatorName === 'BlockStatement' && mutant.line === 7,
      )
      const arithmeticMutant = withDiagnostics.find(
        (mutant) => mutant.mutatorName === 'ArithmeticOperator' && mutant.replacement === '-',
      )

      return emptyBlockMutant?.compileError?.code === 2355 && arithmeticMutant?.compileError === undefined
    },
  )

  it.prop(
    'Registry Exhaustiveness Invariant 5: defaultMutators registry families are either covered or declared gaps',
    { of: [S.Literals(Object.keys(defaultMutators))], subject: checkFamilyExhaustiveness, runs: 100 },
    (subject, [family]) => subject(family, coveredFamilies(MUTATOR_REGISTRY), DECLARED_GAPS),
  )

  it.prop(
    'Registry Exhaustiveness: injecting a synthetic 17th family into a stubbed registry fails with the family named',
    { of: [S.Literals(Object.keys(stubRegistry))], subject: checkFamilyExhaustiveness, runs: 100 },
    (subject, [family]) => {
      try {
        subject(family, stubCovered, DECLARED_GAPS)
        return family !== 'SyntheticMutator'
      } catch (error) {
        return family === 'SyntheticMutator' && String(error).includes('SyntheticMutator')
      }
    },
  )

  it.prop(
    'Count-Equality Property 6: covered mutator registry rows equal analyzer placement counts and replacements',
    { of: [S.Literals(Object.keys(MUTATOR_REGISTRY))], subject: analyzeCode, runs: 100 },
    (subject, [familyName]) => {
      const entry = MUTATOR_REGISTRY[familyName]
      if (entry === undefined) {
        return false
      }
      const familyMutants = subject(entry.snippet).mutants.filter((mutant) => mutant.mutatorName === familyName)

      return familyMutants.length === entry.placementCount &&
        familyMutants.length === entry.replacements.length &&
        familyMutants.every((mutant, index) => mutant.replacement === entry.replacements[index])
    },
  )

  it.prop(
    'Contract Sync 7: every registry table row cites a section heading in mutator-contract.md',
    { of: [S.Literals(Object.keys(MUTATOR_REGISTRY))], subject: contractHeadingFor, runs: 100 },
    (subject, [family]) => {
      const heading = subject(family)

      return heading !== undefined && heading.toLowerCase().includes(family.toLowerCase())
    },
  )

  it.prop(
    'Metamorphic Invariant 8: Dead-Code Invariance (Mutants placed in unreachable blocks follow contract)',
    { of: [ReachableStatement], subject: analyzeCode, runs: 200 },
    (subject, [statement]) => {
      const baseInventory = subject(statement)

      const { transformedSource: codeWithDeadCode } = injectDeadCode(statement)
      const deadInventory = analyzeFileWithTsMorph(codeWithDeadCode, [])

      const expectedArithmeticGrowth = 1
      const actualArithmeticGrowth = (deadInventory.mutatorTally['ArithmeticOperator'] ?? 0) -
        (baseInventory.mutatorTally['ArithmeticOperator'] ?? 0)

      if (actualArithmeticGrowth !== expectedArithmeticGrowth) {
        return false
      }

      const { transformedSource: codeWithDisabledDeadCode } = injectDeadCode(statement, { disabled: true })
      const disabledDeadInventory = analyzeFileWithTsMorph(codeWithDisabledDeadCode, [])

      return disabledDeadInventory.ignoredCount > baseInventory.ignoredCount
    },
  )

  it.prop(
    'Metamorphic Invariant 9: Statement Commutativity (Order-independent statements yield identical tallies)',
    { of: [IndependentPair], subject: analyzeCode, runs: 200 },
    (subject, [[first, second]]) => {
      const original = [first, second]
      const { shuffled } = shuffleIndependentStatements(original)

      const baseline = subject(original.join('\n'))
      const reordered = analyzeFileWithTsMorph(shuffled.join('\n'), [])

      if (baseline.mutants.length !== reordered.mutants.length) {
        return false
      }

      return Object.entries(baseline.mutatorTally).every(([mutator, count]) =>
        reordered.mutatorTally[mutator] === count
      )
    },
  )

  it.prop(
    'Metamorphic Invariant 10: Boolean & Arithmetic Duality (De Morgan duality preserves contract tallies)',
    { of: [DualityInput], subject: analyzeCode, runs: 200 },
    (subject, [[left, op, right]]) => {
      const { originalExpr, dualExpr, originalLogicalCount, dualLogicalCount, dualPrefixBangCount } =
        dualizeBooleanArithmetic(left, op, right)

      const origInventory = subject(`const _b = ${originalExpr};`)
      const dualInventory = analyzeFileWithTsMorph(`const _b = ${dualExpr};`, [])

      const origLogical = origInventory.mutatorTally['LogicalOperator'] ?? 0
      const dualLogical = dualInventory.mutatorTally['LogicalOperator'] ?? 0
      const dualBool = dualInventory.mutatorTally['BooleanLiteral'] ?? 0

      return origLogical === originalLogicalCount && dualLogical === dualLogicalCount && dualBool >= dualPrefixBangCount
    },
  )

  it.prop(
    'Metamorphic Invariant 11: Directive Scope Invariance (disable next-line does not leak across boundaries)',
    { of: [TargetStatement, SurroundingStatement], subject: analyzeCode, runs: 200 },
    (subject, [targetStatement, afterStatement]) => {
      const codeWithDisabled = injectDisableNextLine(targetStatement, [], [afterStatement], true)
      const inventory = subject(codeWithDisabled)

      const targetIgnored = inventory.mutants.some((mutant) => mutant.status === 'Ignored' && mutant.line === 2)
      const afterActive = inventory.mutants.some((mutant) => mutant.status === 'Active' && mutant.line === 4)

      return targetIgnored && afterActive
    },
  )

  it.prop(
    'Metamorphic Invariant 12: Mutation Subsumption bounded (Nested const-initializers place independent mutants)',
    { of: [SubsumptionInput], subject: analyzeCode, runs: 200 },
    (subject, [[a, b, c, d]]) => {
      const { sourceCode, totalArithmeticPlacements } = nestSubsumingExpressions(
        { left: a, op: '+', right: b },
        '*',
        { left: c, op: '+', right: d },
      )

      const arithMutants = subject(sourceCode).mutants.filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')

      return arithMutants.length === totalArithmeticPlacements
    },
  )
})
