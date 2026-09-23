import { Project } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import { determineCompileErrorsWithDiagnostics, evaluateWithProjects } from './oracle/diagnostics.js'
import { type CompileErrorFlags, deriveStaticOracleSlice } from './oracle/status-derivation.js'

interface MutableInMemoryProject {
  readonly project: Project
  getOrCreate: (filePath: string, text: string) => void
}

function buildInMemoryComposite(files: Readonly<Record<string, string>>): MutableInMemoryProject {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } })
  const created = new Set<string>()
  const getOrCreate = (filePath: string, text: string): void => {
    if (created.has(filePath)) {
      project.getSourceFile(filePath)?.replaceWithText(text)
      return
    }
    project.createSourceFile(filePath, text)
    created.add(filePath)
  }
  for (const [fp, text] of Object.entries(files)) {
    getOrCreate(fp, text)
  }
  return { project, getOrCreate }
}

describe('composite per-package diagnostics', () => {
  it('happy: a downstream type-contract break surfaces the imported-file diagnostic', () => {
    const providerText = [
      'export interface User {',
      '  readonly id: string;',
      '  readonly name: string;',
      '}',
      'export function getUser(): User {',
      '  return { id: "1", name: "Alice" };',
      '}',
    ].join('\n')
    const consumerText = [
      'import { getUser, type User } from "./provider.js";',
      'export function getGreeting(): string {',
      '  const user: User = getUser();',
      '  return "Hello, " + user.name;',
      '}',
    ].join('\n')

    const providerInventory = analyzeFileWithTsMorph(providerText, [])
    const candidate = providerInventory.mutants.find((m) => m.mutatorName === 'ObjectLiteral')
    expect(candidate).toBeDefined()
    if (candidate === undefined) return

    const composite = buildInMemoryComposite({
      '/proj/src/provider.ts': providerText,
      '/proj/src/consumer.ts': consumerText,
    })

    const mutatedProvider = providerText.slice(0, candidate.start) +
      candidate.replacement +
      providerText.slice(candidate.end)

    const projects = [{
      packageDir: '/proj',
      tsConfigPath: '/proj/tsconfig.json',
      project: composite.project,
    }]

    const [result] = evaluateWithProjects(
      projects,
      '/proj/src/provider.ts',
      mutatedProvider,
      [candidate],
    )

    expect(result).toBeDefined()
    expect(result.compileError).toBeDefined()
    if (result.compileError === undefined) return

    expect(result.compileError.code).toBe(2739)
    expect(result.compileError.message.toLowerCase()).toContain('missing the following properties')
  })

  it('happy: single-file path still surfaces the in-place diagnostic', () => {
    const code = [
      'export const calculate = (x: number): number => {',
      '  if (x > 0) {',
      '    return x + 1;',
      '  }',
      '  return 0;',
      '};',
    ].join('\n')

    const inventory = analyzeFileWithTsMorph(code, [])
    const withDiagnostics = determineCompileErrorsWithDiagnostics(code, inventory.mutants)

    const bodyBlockMutant = withDiagnostics.find(
      (m) => m.mutatorName === 'BlockStatement' && m.line === 1,
    )
    expect(bodyBlockMutant?.compileError?.code).toBe(2355)
  })

  it('edge: a Stryker disable next-line mutant is Ignored and never diagnosed', () => {
    const code = [
      '// Stryker disable next-line EqualityOperator',
      'export const eq = (a: number, b: number): boolean => a === b;',
    ].join('\n')

    const inventory = analyzeFileWithTsMorph(code, [])
    const eqMutant = inventory.mutants.find((m) => m.mutatorName === 'EqualityOperator')
    expect(eqMutant).toBeDefined()
    if (eqMutant === undefined) return
    expect(eqMutant.status).toBe('Ignored')

    const flags: CompileErrorFlags = { codesByMutator: {} }
    const withDiagnostics = determineCompileErrorsWithDiagnostics(code, [eqMutant])
    expect(withDiagnostics[0]?.compileError).toBeUndefined()

    const slice = deriveStaticOracleSlice(inventory, flags)
    expect(slice.ignoredCount).toBe(1)
    expect(slice.compileErrorCount).toBe(0)
    expect(slice.familyTally).toEqual({})
  })

  it('edge: zero-valid-mutant file produces an empty tally (NaN-score guard)', () => {
    const code = 'export const nothing: number = 1;'

    const inventory = analyzeFileWithTsMorph(code, [])
    expect(inventory.mutants).toHaveLength(0)
    expect(inventory.activeCount).toBe(0)

    const flags: CompileErrorFlags = { codesByMutator: {} }
    const slice = deriveStaticOracleSlice(inventory, flags)
    expect(slice.familyTally).toEqual({})
    expect(slice.compileErrorCount).toBe(0)
    expect(slice.ignoredCount).toBe(0)
    expect(slice.blockers).toEqual([])
  })

  it('error: excludedMutations family is still tallied as Ignored in the static slice', () => {
    const code = [
      'export const eq = (a: number, b: number): boolean => a === b;',
      'export const cond = (a: number, b: number): number => (a > b) ? a : b;',
    ].join('\n')

    const excluded = ['EqualityOperator', 'ConditionalExpression', 'ArrowFunction']
    const inventory = analyzeFileWithTsMorph(code, excluded)
    expect(inventory.mutants.every((m) => m.status === 'Ignored')).toBe(true)
    expect(inventory.ignoredCount).toBeGreaterThan(0)

    const flags: CompileErrorFlags = { codesByMutator: {} }
    const slice = deriveStaticOracleSlice(inventory, flags)
    expect(slice.ignoredCount).toBe(inventory.ignoredCount)
    expect(slice.familyTally).toEqual({})
    expect(slice.compileErrorCount).toBe(0)
    expect(slice.blockers).toEqual([])
  })

  it('passes Ignored mutants straight through evaluateWithProjects without diagnosing', () => {
    const code = [
      '// Stryker disable next-line EqualityOperator',
      'export const eq = (a: number, b: number): boolean => a === b;',
    ].join('\n')

    const inventory = analyzeFileWithTsMorph(code, [])
    const ignored = inventory.mutants.find((m) => m.mutatorName === 'EqualityOperator')
    expect(ignored?.status).toBe('Ignored')
    if (ignored === undefined) return

    const composite = buildInMemoryComposite({ '/proj/src/x.ts': code })
    const projects = [{
      packageDir: '/proj',
      tsConfigPath: '/proj/tsconfig.json',
      project: composite.project,
    }]

    const [result] = evaluateWithProjects(projects, '/proj/src/x.ts', code, [ignored])
    expect(result.compileError).toBeUndefined()
  })
})
