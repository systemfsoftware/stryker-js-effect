import { describe } from '@systemfsoftware/vitest'
import { Project } from 'ts-morph'
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

describe('composite per-package diagnostics', (it) => {
  it('happy: a downstream type-contract break surfaces the imported-file diagnostic', function*({ expect }) {
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
    if (candidate === undefined) throw new Error('expected an ObjectLiteral mutant in the provider inventory')

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

    yield* expect({ candidate, compileError: result?.compileError }).toMatchObject({
      candidate: expect.objectContaining({ mutatorName: 'ObjectLiteral' }),
      compileError: { code: 2739, message: expect.stringMatching(/missing the following properties/i) },
    })
  })

  it('happy: single-file path still surfaces the in-place diagnostic', function*({ expect }) {
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

    yield* expect(bodyBlockMutant?.compileError?.code).toBe(2355)
  })

  it('edge: a Stryker disable next-line mutant is Ignored and never diagnosed', function*({ expect }) {
    const code = [
      '// Stryker disable next-line EqualityOperator',
      'export const eq = (a: number, b: number): boolean => a === b;',
    ].join('\n')

    const inventory = analyzeFileWithTsMorph(code, [])
    const eqMutant = inventory.mutants.find((m) => m.mutatorName === 'EqualityOperator')
    if (eqMutant === undefined) throw new Error('expected an Ignored EqualityOperator mutant')

    const flags: CompileErrorFlags = { codesByMutator: {} }
    const withDiagnostics = determineCompileErrorsWithDiagnostics(code, [eqMutant])
    const slice = deriveStaticOracleSlice(inventory, flags)

    yield* expect({
      status: eqMutant.status,
      diagnosed: withDiagnostics[0]?.compileError,
      ignoredCount: slice.ignoredCount,
      compileErrorCount: slice.compileErrorCount,
      familyTally: slice.familyTally,
    }).toStrictEqual({
      status: 'Ignored',
      diagnosed: undefined,
      ignoredCount: 1,
      compileErrorCount: 0,
      familyTally: {},
    })
  })

  it('edge: zero-valid-mutant file produces an empty tally (NaN-score guard)', function*({ expect }) {
    const code = 'export const nothing: number = 1;'

    const inventory = analyzeFileWithTsMorph(code, [])
    const flags: CompileErrorFlags = { codesByMutator: {} }
    const slice = deriveStaticOracleSlice(inventory, flags)

    yield* expect({
      mutants: inventory.mutants,
      activeCount: inventory.activeCount,
      familyTally: slice.familyTally,
      compileErrorCount: slice.compileErrorCount,
      ignoredCount: slice.ignoredCount,
      blockers: slice.blockers,
    }).toEqual({
      mutants: [],
      activeCount: 0,
      familyTally: {},
      compileErrorCount: 0,
      ignoredCount: 0,
      blockers: [],
    })
  })

  it('error: excludedMutations family is still tallied as Ignored in the static slice', function*({ expect }) {
    const code = [
      'export const eq = (a: number, b: number): boolean => a === b;',
      'export const cond = (a: number, b: number): number => (a > b) ? a : b;',
    ].join('\n')

    const excluded = ['EqualityOperator', 'ConditionalExpression', 'ArrowFunction']
    const inventory = analyzeFileWithTsMorph(code, excluded)

    const flags: CompileErrorFlags = { codesByMutator: {} }
    const slice = deriveStaticOracleSlice(inventory, flags)

    yield* expect({
      statuses: [...new Set(inventory.mutants.map((m) => m.status))],
      ignoredCount: inventory.ignoredCount,
      sliceIgnoredCount: slice.ignoredCount,
      familyTally: slice.familyTally,
      compileErrorCount: slice.compileErrorCount,
      blockers: slice.blockers,
    }).toSatisfy(
      (observed) =>
        observed.statuses.join(',') === 'Ignored' &&
        observed.ignoredCount > 0 &&
        observed.sliceIgnoredCount === observed.ignoredCount &&
        Object.keys(observed.familyTally).length === 0 &&
        observed.compileErrorCount === 0 &&
        observed.blockers.length === 0,
      'every excluded family is Ignored and the static slice tallies them identically with no compile errors',
    )
  })

  it('passes Ignored mutants straight through evaluateWithProjects without diagnosing', function*({ expect }) {
    const code = [
      '// Stryker disable next-line EqualityOperator',
      'export const eq = (a: number, b: number): boolean => a === b;',
    ].join('\n')

    const inventory = analyzeFileWithTsMorph(code, [])
    const ignored = inventory.mutants.find((m) => m.mutatorName === 'EqualityOperator')
    if (ignored === undefined) throw new Error('expected an Ignored EqualityOperator mutant')

    const composite = buildInMemoryComposite({ '/proj/src/x.ts': code })
    const projects = [{
      packageDir: '/proj',
      tsConfigPath: '/proj/tsconfig.json',
      project: composite.project,
    }]

    const [result] = evaluateWithProjects(projects, '/proj/src/x.ts', code, [ignored])

    yield* expect({
      status: ignored.status,
      resultDefined: result !== undefined,
      compileError: result?.compileError,
    }).toStrictEqual({ status: 'Ignored', resultDefined: true, compileError: undefined })
  })
})
