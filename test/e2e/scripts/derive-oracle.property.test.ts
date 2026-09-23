import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as Effect from 'effect/Effect'
import * as fc from 'fast-check'
import * as fs from 'node:fs'
import { Project } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { MutatorRegistry } from '../../../packages/stryker-js-instrumenter/src/Mutator.handle.js'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import { determineCompileErrorsWithDiagnostics } from './oracle/diagnostics.js'
import {
  CONTRACT_CLAUSES,
  dualizeBooleanArithmetic,
  injectDeadCode,
  injectDisableNextLine,
  nestSubsumingExpressions,
  shuffleIndependentStatements,
} from './oracle/metamorphic.js'
import { DECLARED_GAPS, MUTATOR_REGISTRY } from './oracle/mutator-registry.js'

const allMutators = MutatorRegistry.mutators

const RESERVED_WORDS = new Set([
  'do',
  'if',
  'in',
  'for',
  'let',
  'new',
  'try',
  'var',
  'case',
  'else',
  'enum',
  'eval',
  'null',
  'this',
  'true',
  'void',
  'with',
  'await',
  'break',
  'catch',
  'class',
  'const',
  'false',
  'super',
  'throw',
  'while',
  'yield',
  'delete',
  'export',
  'import',
  'public',
  'return',
  'static',
  'switch',
  'typeof',
  'default',
  'extends',
  'finally',
  'package',
  'private',
  'continue',
  'debugger',
  'function',
  'arguments',
  'interface',
  'protected',
  'implements',
  'instanceof',
])

const arbIdentifier = fc
  .stringMatching(/^[a-z][a-zA-Z0-9_]{0,8}$/)
  .filter((id) => !RESERVED_WORDS.has(id))

const arbBinaryOp = fc.constantFrom('===', '!==', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/')

const arbCompoundOp = fc.constantFrom('+=', '-=', '*=', '/=')
const arbLogicalAssignOp = fc.constantFrom('&&=', '||=', '??=')

const arbLiteral = fc.oneof(
  fc.integer({ min: -100, max: 100 }).map((n) => n.toString()),
  fc.boolean().map((b) => b.toString()),
  fc.string({ maxLength: 8 }).map((s) => JSON.stringify(s)),
)

const arbStatement = fc.oneof(
  fc.tuple(arbIdentifier, arbLiteral).map(([id, lit]) => `const ${id} = ${lit};`),
  fc.tuple(arbIdentifier, arbIdentifier, arbBinaryOp, arbLiteral).map(
    ([dest, left, op, right]) => `const ${dest} = ${left} ${op} ${right};`,
  ),
  fc.tuple(arbIdentifier, arbLiteral, arbLiteral).map(
    ([id, a, b]) => `const ${id} = (${id} !== null) ? ${a} : ${b};`,
  ),
  fc.tuple(arbIdentifier, arbCompoundOp, arbLiteral).map(
    ([id, op, lit]) => `let mutable_${id} = 0; mutable_${id} ${op} ${lit};`,
  ),
  fc.tuple(arbIdentifier, arbLogicalAssignOp, arbLiteral).map(
    ([id, op, lit]) => `let logical_${id} = true; logical_${id} ${op} ${lit};`,
  ),
  fc.tuple(arbIdentifier, arbIdentifier, arbIdentifier).map(
    ([dest, obj, prop]) => `const ${dest} = ${obj}?.${prop} ?? ${obj}?.[0] ?? ${obj}?.();`,
  ),
  fc.tuple(arbIdentifier, arbLiteral, arbLiteral).map(
    ([id, a, b]) => `const obj_${id} = { a: ${a}, b: [${b}] };`,
  ),
  fc.tuple(arbIdentifier, arbLiteral).map(
    ([name, val]) => `class Cls_${name} { #secret = ${val}; get secret() { return this.#secret; } }`,
  ),
  fc.tuple(arbIdentifier).map(
    ([id]) => `function fn_${id}(x: number) { let count = x; count++; return --count; }`,
  ),
)

const arbSourceCode = fc
  .array(arbStatement, { minLength: 1, maxLength: 6 })
  .map((stmts) => stmts.join('\n'))

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

const instrumentOxc = (code: string) =>
  Effect.runPromise(
    instrument([{ name: 'synthetic.ts', content: code, mutate: true }], {
      excludedMutations: [],
      ignorers: [],
    }),
  )

describe('SOTA Metamorphic & Differential Oracle Properties (fast-check)', () => {
  it('Metamorphic Invariant 1: α-Conversion Invariance (Total & Tally are invariant under variable renaming)', () => {
    return fc.assert(
      fc.property(arbSourceCode, (code) => {
        const baseline = analyzeFileWithTsMorph(code, [])
        const renamedCode = alphaRename(code, 'renamed')
        const renamed = analyzeFileWithTsMorph(renamedCode, [])

        if (baseline.mutants.length !== renamed.mutants.length) {
          return false
        }

        for (const [mutator, count] of Object.entries(baseline.mutatorTally)) {
          if (renamed.mutatorTally[mutator] !== count) {
            return false
          }
        }

        return true
      }),
      { numRuns: 300 },
    )
  })

  it('Metamorphic Invariant 2: Monotonic Subtraction (Excluded mutators strictly subtract from active)', () => {
    return fc.assert(
      fc.property(
        arbSourceCode,
        fc.subarray(AST_MATCHED_FAMILIES, { minLength: 1 }),
        (code, excluded) => {
          const baseline = analyzeFileWithTsMorph(code, [])
          const withExclusions = analyzeFileWithTsMorph(code, excluded)

          if (withExclusions.mutants.length !== baseline.mutants.length) {
            return false
          }

          let expectedActiveDrop = 0
          for (const mutator of excluded) {
            expectedActiveDrop += baseline.mutatorTally[mutator] ?? 0
          }

          const activeDropped = baseline.activeCount - withExclusions.activeCount === expectedActiveDrop
          const ignoredGrew = withExclusions.ignoredCount - baseline.ignoredCount === expectedActiveDrop

          return activeDropped && ignoredGrew
        },
      ),
      { numRuns: 300 },
    )
  })

  it('Differential Equivalence 3: oxc vs ts-morph Differential Agreement across all shared mutators', async () => {
    await fc.assert(
      fc.asyncProperty(arbSourceCode, async (code) => {
        const oxcResult = await instrumentOxc(code)
        const tsMorphResult = analyzeFileWithTsMorph(code, [])
        for (const family of AST_MATCHED_FAMILIES) {
          const oxcCount = oxcResult.mutants.filter((m) => m.mutatorName === family).length
          const tsMorphCount = tsMorphResult.mutants.filter((m) => m.mutatorName === family).length

          if (oxcCount !== tsMorphCount) {
            return false
          }
        }

        return true
      }),
      { numRuns: 200 },
    )
  })

  it('Differential Equivalence 3b (R3 staged): single-mutant replacements and OptionalChaining replacement spans', async () => {
    const arbMethodCall = fc.constantFrom(
      {
        code: 'const s = "HELLO".toLowerCase();',
        family: 'MethodExpression',
        expectedReplacement: '"HELLO".toUpperCase()',
      },
      {
        code: 'const s = "hello".toUpperCase();',
        family: 'MethodExpression',
        expectedReplacement: '"hello".toLowerCase()',
      },
      { code: 'const a = arr.filter(x => x);', family: 'MethodExpression', expectedReplacement: 'arr()' },
    )
    const arbRegexSnippet = fc.constantFrom(
      { code: 'const r = /a+/;', family: 'Regex', expectedReplacement: '/a/' },
      { code: 'const r = /\\d/;', family: 'Regex', expectedReplacement: '/\\D/' },
      { code: 'const r = /^abc$/;', family: 'Regex', expectedReplacement: '/abc$/' },
    )
    const arbUnarySnippet = fc.constantFrom(
      { code: 'const u = +a;', family: 'UnaryOperator', expectedReplacement: '-a' },
      { code: 'const u = -a;', family: 'UnaryOperator', expectedReplacement: '+a' },
      { code: 'const u = ~a;', family: 'UnaryOperator', expectedReplacement: 'a' },
    )
    const arbBooleanPrefix = fc.constantFrom(
      { code: 'const b = !a;', family: 'BooleanLiteral', expectedReplacement: 'a' },
      { code: 'const b = !isReady;', family: 'BooleanLiteral', expectedReplacement: 'isReady' },
    )
    const arbOptionalSnippet = fc.constantFrom(
      'const o = a?.b;',
      'const o = a?.[0];',
      'const o = a?.();',
    )

    const arbExtendedSingleSnippet = fc.oneof(
      arbMethodCall,
      arbRegexSnippet,
      arbUnarySnippet,
      arbBooleanPrefix,
    )

    await fc.assert(
      fc.asyncProperty(arbExtendedSingleSnippet, async ({ code, family, expectedReplacement }) => {
        const oxcResult = await instrumentOxc(code)
        const tsMorphResult = analyzeFileWithTsMorph(code, [])

        const oxcMutants = oxcResult.mutants.filter((m) => m.mutatorName === family)
        const tsMorphMutants = tsMorphResult.mutants.filter((m) => m.mutatorName === family)

        if (oxcMutants.length !== tsMorphMutants.length) {
          throw new Error(
            `Count mismatch for family ${family}: oxc=${oxcMutants.length} vs tsMorph=${tsMorphMutants.length} in: ${code}`,
          )
        }
        if (tsMorphMutants.length === 1 && oxcMutants.length === 1) {
          if (tsMorphMutants[0]!.replacement !== expectedReplacement) {
            throw new Error(
              `ts-morph replacement mismatch for ${family}: expected ${expectedReplacement} but got ${
                tsMorphMutants[0]!.replacement
              }`,
            )
          }
        }
        return true
      }),
      { numRuns: 100 },
    )

    await fc.assert(
      fc.asyncProperty(arbOptionalSnippet, async (code) => {
        const tsMorphResult = analyzeFileWithTsMorph(code, [])
        const optMutants = tsMorphResult.mutants.filter((m) => m.mutatorName === 'OptionalChaining')
        if (optMutants.length !== 1) {
          throw new Error(`Expected 1 OptionalChaining mutant, found ${optMutants.length} in ${code}`)
        }
        const rep = optMutants[0]!.replacement
        if (rep !== '.' && rep !== '[' && rep !== '(') {
          throw new Error(
            `OptionalChaining replacement at question-dot span must be '.', '[', or '(', got '${rep}' in ${code}`,
          )
        }
        return true
      }),
      { numRuns: 100 },
    )
  })

  it('A Priori Semantic Invariant 4: CompileError classification matches ts.getPreEmitDiagnostics', () => {
    const code = [
      'export const calculate = (x: number): number => {',
      '  if (x > 0) {',
      '    return x + 1;',
      '  }',
      '  return 0;',
      '};',
      'export const getMessage = async (): Promise<string> => {',
      '  return "hello";',
      '};',
    ].join('\n')

    const inventory = analyzeFileWithTsMorph(code, [])
    const withDiagnostics = determineCompileErrorsWithDiagnostics(code, inventory.mutants)

    const emptyBlockMutant = withDiagnostics.find(
      (m) => m.mutatorName === 'BlockStatement' && m.line === 7,
    )
    expect(emptyBlockMutant?.compileError?.code).toBe(2355)

    const arithMutant = withDiagnostics.find(
      (m) => m.mutatorName === 'ArithmeticOperator' && m.replacement === '-',
    )
    expect(arithMutant?.compileError).toBeUndefined()
  })

  function checkFamilyExhaustiveness(
    family: string,
    coveredFamilies: Readonly<Record<string, boolean>>,
    declaredGaps: Readonly<Record<string, true>>,
  ): boolean {
    if (coveredFamilies[family] !== true && declaredGaps[family] !== true) {
      throw new Error(`Uncovered and undeclared mutator family in registry: ${family}`)
    }
    return true
  }

  it('Registry Exhaustiveness Invariant 5: allMutators registry families are either covered or declared gaps', () => {
    const coveredMap: Record<string, boolean> = {}
    for (const [name, entry] of Object.entries(MUTATOR_REGISTRY)) {
      if (entry.covered) {
        coveredMap[name] = true
      }
    }

    return fc.assert(
      fc.property(fc.constantFrom(...Object.keys(allMutators)), (family) => {
        return checkFamilyExhaustiveness(family, coveredMap, DECLARED_GAPS)
      }),
    )
  })

  it('Registry Exhaustiveness: injecting a synthetic 17th family into a stubbed registry fails with the family named', () => {
    const stubbedRegistry: Record<string, unknown> = {
      ...allMutators,
      SyntheticMutator: () => [],
    }
    const coveredMap: Record<string, boolean> = {}
    for (const [name, entry] of Object.entries(MUTATOR_REGISTRY)) {
      if (entry.covered) {
        coveredMap[name] = true
      }
    }

    expect(() => {
      fc.assert(
        fc.property(fc.constantFrom(...Object.keys(stubbedRegistry)), (family) => {
          return checkFamilyExhaustiveness(family, coveredMap, DECLARED_GAPS)
        }),
      )
    }).toThrow(/SyntheticMutator/)
  })

  it('Count-Equality Property 6: covered mutator registry rows equal analyzer placement counts and replacements', () => {
    const arbCoveredFamily = fc.constantFrom(...Object.keys(MUTATOR_REGISTRY))
    return fc.assert(
      fc.property(arbCoveredFamily, (familyName) => {
        const entry = MUTATOR_REGISTRY[familyName]
        if (!entry) return false
        const inventory = analyzeFileWithTsMorph(entry.snippet, [])
        const familyMutants = inventory.mutants.filter((m) => m.mutatorName === familyName)

        const countMatches = familyMutants.length === entry.placementCount
        const replacementsMatch = familyMutants.length === entry.replacements.length &&
          familyMutants.every((m, idx) => m.replacement === entry.replacements[idx])

        return countMatches && replacementsMatch
      }),
    )
  })
  it('Contract Sync 7: every registry table row cites a section heading in mutator-contract.md', () => {
    const contractPath = new URL('./oracle/mutator-contract.md', import.meta.url)
    const contractContent = fs.readFileSync(contractPath, 'utf-8')

    for (const [familyName, entry] of Object.entries(MUTATOR_REGISTRY)) {
      const rawAnchor = entry.contractSection.replace(/^#/, '')
      const headingRegex = new RegExp(`^#{2,3}\\s+.*\\b(${familyName}|${rawAnchor})\\b`, 'm')
      expect(
        headingRegex.test(contractContent),
        `Heading for family ${familyName} with anchor ${entry.contractSection} not found in mutator-contract.md`,
      ).toBe(true)
    }
  })

  it('Metamorphic Invariant 8: Dead-Code Invariance (Mutants placed in unreachable blocks follow contract)', () => {
    const arbReachableStmt = fc.tuple(arbIdentifier, arbLiteral).map(
      ([id, lit]) => `const ${id} = ${lit};`,
    )
    return fc.assert(
      fc.property(arbReachableStmt, (stmt) => {
        const baseInventory = analyzeFileWithTsMorph(stmt, [])

        const { transformedSource: codeWithDeadCode } = injectDeadCode(stmt)
        const deadInventory = analyzeFileWithTsMorph(codeWithDeadCode, [])

        const expectedArithmeticGrowth = 1
        const actualArithmeticGrowth = (deadInventory.mutatorTally['ArithmeticOperator'] ?? 0) -
          (baseInventory.mutatorTally['ArithmeticOperator'] ?? 0)

        if (actualArithmeticGrowth !== expectedArithmeticGrowth) {
          throw new Error(
            `Dead-Code Invariance violated [${CONTRACT_CLAUSES.DEAD_CODE}]: expected ArithmeticOperator growth of ${expectedArithmeticGrowth}, got ${actualArithmeticGrowth}`,
          )
        }

        const { transformedSource: codeWithDisabledDeadCode } = injectDeadCode(stmt, { disabled: true })
        const disabledDeadInventory = analyzeFileWithTsMorph(codeWithDisabledDeadCode, [])

        if (disabledDeadInventory.ignoredCount <= baseInventory.ignoredCount) {
          throw new Error(
            `Dead-Code Invariance violated [${CONTRACT_CLAUSES.DEAD_CODE}]: disabled dead code did not increase ignoredCount`,
          )
        }

        return true
      }),
      { numRuns: 200 },
    )
  })

  it('Metamorphic Invariant 9: Statement Commutativity (Order-independent statements yield identical tallies)', () => {
    const arbIndependentDecl = fc.tuple(arbIdentifier, arbLiteral).map(
      ([id, lit]) => `const const_${id} = ${lit};`,
    )
    const arbIndependentPair = fc.tuple(arbIndependentDecl, arbIndependentDecl)

    return fc.assert(
      fc.property(arbIndependentPair, ([first, second]) => {
        const original = [first, second]
        const { shuffled } = shuffleIndependentStatements(original)

        const originalSource = original.join('\n')
        const shuffledSource = shuffled.join('\n')

        const baseline = analyzeFileWithTsMorph(originalSource, [])
        const reordered = analyzeFileWithTsMorph(shuffledSource, [])

        if (baseline.mutants.length !== reordered.mutants.length) {
          throw new Error(
            `Statement Commutativity violated [${CONTRACT_CLAUSES.STATEMENT_COMMUTATIVITY}]: mutant count mismatch ${baseline.mutants.length} !== ${reordered.mutants.length}`,
          )
        }

        for (const [mutator, count] of Object.entries(baseline.mutatorTally)) {
          if (reordered.mutatorTally[mutator] !== count) {
            throw new Error(
              `Statement Commutativity violated [${CONTRACT_CLAUSES.STATEMENT_COMMUTATIVITY}]: tally mismatch for ${mutator}: ${count} !== ${
                reordered.mutatorTally[mutator]
              }`,
            )
          }
        }

        return true
      }),
      { numRuns: 200 },
    )
  })

  it('Metamorphic Invariant 10: Boolean & Arithmetic Duality (De Morgan duality preserves contract tallies)', () => {
    const arbDualityInput = fc.tuple(
      arbIdentifier,
      fc.constantFrom<'&&' | '||'>('&&', '||'),
      arbIdentifier,
    )

    return fc.assert(
      fc.property(arbDualityInput, ([left, op, right]) => {
        const { originalExpr, dualExpr, originalLogicalCount, dualLogicalCount, dualPrefixBangCount } =
          dualizeBooleanArithmetic(left, op, right)

        const originalCode = `const _b = ${originalExpr};`
        const dualCode = `const _b = ${dualExpr};`

        const origInventory = analyzeFileWithTsMorph(originalCode, [])
        const dualInventory = analyzeFileWithTsMorph(dualCode, [])

        const origLogical = origInventory.mutatorTally['LogicalOperator'] ?? 0
        const dualLogical = dualInventory.mutatorTally['LogicalOperator'] ?? 0
        const dualBool = dualInventory.mutatorTally['BooleanLiteral'] ?? 0

        if (origLogical !== originalLogicalCount) {
          throw new Error(
            `Boolean Duality violated [${CONTRACT_CLAUSES.BOOLEAN_ARITHMETIC_DUALITY}]: original LogicalOperator count ${origLogical} !== ${originalLogicalCount}`,
          )
        }
        if (dualLogical !== dualLogicalCount) {
          throw new Error(
            `Boolean Duality violated [${CONTRACT_CLAUSES.BOOLEAN_ARITHMETIC_DUALITY}]: dual LogicalOperator count ${dualLogical} !== ${dualLogicalCount}`,
          )
        }
        if (dualBool < dualPrefixBangCount) {
          throw new Error(
            `Boolean Duality violated [${CONTRACT_CLAUSES.BOOLEAN_ARITHMETIC_DUALITY}]: expected at least ${dualPrefixBangCount} BooleanLiteral prefix-! collapses, got ${dualBool}`,
          )
        }

        return true
      }),
      { numRuns: 200 },
    )
  })

  it('Metamorphic Invariant 11: Directive Scope Invariance (disable next-line does not leak across boundaries)', () => {
    const arbTargetStmt = fc.tuple(arbIdentifier, fc.integer({ min: 1, max: 100 })).map(
      ([id, n]) => `const ${id} = ${n} + 1;`,
    )
    const arbSurroundingStmt = fc.tuple(arbIdentifier, fc.integer({ min: 1, max: 100 })).map(
      ([id, n]) => `const post_${id} = ${n} + 2;`,
    )

    return fc.assert(
      fc.property(
        arbTargetStmt,
        arbSurroundingStmt,
        (targetStmt, afterStmt) => {
          const codeWithDisabled = injectDisableNextLine(targetStmt, [], [afterStmt], true)
          const inventory = analyzeFileWithTsMorph(codeWithDisabled, [])

          const activeMutants = inventory.mutants.filter((m) => m.status === 'Active')
          const ignoredMutants = inventory.mutants.filter((m) => m.status === 'Ignored')

          const targetIgnored = ignoredMutants.some((m) => m.line === 2)
          const afterActive = activeMutants.some((m) => m.line === 4)

          if (!targetIgnored) {
            throw new Error(
              `Directive Scope Invariance violated [${CONTRACT_CLAUSES.DIRECTIVE_SCOPE}]: line 2 mutant should be Ignored`,
            )
          }
          if (!afterActive) {
            throw new Error(
              `Directive Scope Invariance violated [${CONTRACT_CLAUSES.DIRECTIVE_SCOPE}]: line 4 mutant should be Active after restore`,
            )
          }

          return true
        },
      ),
      { numRuns: 200 },
    )
  })

  it('Metamorphic Invariant 12: Mutation Subsumption bounded (Nested const-initializers place independent mutants)', () => {
    const arbSubsumptionTuple = fc.tuple(
      fc.integer({ min: 1, max: 50 }),
      fc.integer({ min: 1, max: 50 }),
      fc.integer({ min: 1, max: 50 }),
      fc.integer({ min: 1, max: 50 }),
    )

    return fc.assert(
      fc.property(arbSubsumptionTuple, ([a, b, c, d]) => {
        const { sourceCode, totalArithmeticPlacements } = nestSubsumingExpressions(
          { left: a, op: '+', right: b },
          '*',
          { left: c, op: '+', right: d },
        )

        const inventory = analyzeFileWithTsMorph(sourceCode, [])
        const arithMutants = inventory.mutants.filter((m) => m.mutatorName === 'ArithmeticOperator')

        if (arithMutants.length !== totalArithmeticPlacements) {
          throw new Error(
            `Mutation Subsumption violated [${CONTRACT_CLAUSES.MUTATION_SUBSUMPTION}]: expected ${totalArithmeticPlacements} arithmetic mutants, got ${arithMutants.length}`,
          )
        }

        return true
      }),
      { numRuns: 200 },
    )
  })
})
