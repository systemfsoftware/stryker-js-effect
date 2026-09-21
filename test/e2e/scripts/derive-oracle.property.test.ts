import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import * as Effect from 'effect/Effect'
import * as fc from 'fast-check'
import * as fs from 'node:fs'
import { Project } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { allMutators } from '../../../packages/stryker-js-instrumenter/src/Mutator.js'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import { determineCompileErrorsWithDiagnostics } from './oracle/diagnostics.js'
import { DECLARED_GAPS, MUTATOR_REGISTRY } from './oracle/mutator-registry.js'

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
})
