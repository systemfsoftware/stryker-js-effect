import * as path from 'node:path'
import { Project } from 'ts-morph'
import type { IndependentMutant } from './types.js'

export function determineCompileErrorsWithDiagnostics(
  sourceText: string,
  mutants: readonly IndependentMutant[],
): readonly IndependentMutant[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, noImplicitAny: true, target: 99 },
  })

  return mutants.map((m) => {
    if (m.status === 'Ignored') {
      return m
    }
    const mutated = sourceText.slice(0, m.start) + m.replacement + sourceText.slice(m.end)
    const sf = project.createSourceFile('temp.ts', mutated, { overwrite: true })
    const diags = sf.getPreEmitDiagnostics()
    const errorDiag = diags.find((d) => d.getCategory() === 1)
    if (errorDiag) {
      return {
        ...m,
        compileError: {
          code: errorDiag.getCode(),
          message: errorDiag.getMessageText().toString(),
        },
      }
    }
    return m
  })
}

/**
 * Composite per-package diagnostic oracle.
 *
 * Spike verdict (test/e2e/scripts/oracle/spike/ — deleted after proving this approach):
 * - `Project({ tsConfigFilePath: rootTsconfig })` with a root tsconfig that uses
 *   `files: []` + `references` loads ZERO source files: ts-morph does NOT follow
 *   project references.
 * - WINNER: one `Project` per package tsconfig. A package Project pulls
 *   cross-package files through its import resolution (relative or `paths`),
 *   and mutating an imported module surfaces the downstream diagnostic on
 *   the consuming package's pre-emit diagnostics (observed: TS2353
 *   "Object literal may only specify known properties, and 'age' does not
 *   exist in type 'User'" reported after mutating the imported module).
 */
export interface PackageProject {
  readonly packageDir: string
  readonly tsConfigPath: string
  readonly project: Project
}

export function createPackageProjects(
  fixtureDir: string,
  packageGlobs: readonly string[],
): readonly PackageProject[] {
  const resolvedFixture = path.resolve(fixtureDir)
  const projects: PackageProject[] = []
  for (const rel of packageGlobs) {
    const packageDir = path.resolve(resolvedFixture, rel)
    const tsConfigPath = path.join(packageDir, 'tsconfig.json')
    projects.push({
      packageDir,
      tsConfigPath,
      project: new Project({ tsConfigFilePath: tsConfigPath }),
    })
  }
  return projects
}

interface DiagnosticKeyIndex {
  readonly keys: ReadonlySet<string>
}

const cleanDiagnosticIndex = new WeakMap<readonly PackageProject[], DiagnosticKeyIndex>()

function diagnosticKey(d: Diagnosticish): string {
  return `${d.getCode()}|${d.getSourceFile()?.getFilePath() ?? ''}|${d.getMessageText().toString()}`
}

interface Diagnosticish {
  getCode(): number
  getSourceFile(): { getFilePath(): string } | undefined
  getMessageText(): string | { toString(): string }
  getCategory(): number
}

function errorKeysOf(projects: readonly PackageProject[]): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const entry of projects) {
    for (const d of entry.project.getPreEmitDiagnostics()) {
      if (d.getCategory() === 1) keys.add(diagnosticKey(d))
    }
  }
  return keys
}

function cleanErrorKeys(projects: readonly PackageProject[]): ReadonlySet<string> {
  const existing = cleanDiagnosticIndex.get(projects)
  if (existing !== undefined) return existing.keys
  const fresh = { keys: errorKeysOf(projects) }
  cleanDiagnosticIndex.set(projects, fresh)
  return fresh.keys
}

export function evaluateWithProjects(
  projects: readonly PackageProject[],
  sourcePath: string,
  sourceText: string,
  mutants: readonly IndependentMutant[],
): readonly IndependentMutant[] {
  const absoluteSourcePath = path.resolve(sourcePath)
  const owners = projects.filter((entry) =>
    entry.project.getSourceFile(absoluteSourcePath) !== undefined ||
    entry.project.getSourceFiles().some((sf) => {
      const fp = sf.getFilePath()
      return fp === absoluteSourcePath || fp.replace(/\//g, path.sep) === absoluteSourcePath.replace(/\//g, path.sep)
    })
  )
  if (owners.length === 0) {
    return mutants
  }
  const cleanKeys = cleanErrorKeys(projects)

  return mutants.map((m) => {
    if (m.status === 'Ignored') {
      return m
    }
    const mutated = sourceText.slice(0, m.start) + m.replacement + sourceText.slice(m.end)
    const touched = new Map<Project, string>()

    for (const entry of owners) {
      const ownerSf = entry.project.getSourceFile(absoluteSourcePath)!
      if (!touched.has(entry.project)) {
        touched.set(entry.project, ownerSf.getFullText())
      }
      if (ownerSf.getFullText() !== mutated) {
        ownerSf.replaceWithText(mutated)
      }
    }

    try {
      const errorDiag = owners
        .flatMap((entry) => entry.project.getPreEmitDiagnostics())
        .find((d) => d.getCategory() === 1 && !cleanKeys.has(diagnosticKey(d)))

      if (errorDiag !== undefined) {
        return {
          ...m,
          compileError: {
            code: errorDiag.getCode(),
            message: errorDiag.getMessageText().toString(),
          },
        }
      }
      return m
    } finally {
      for (const [project, original] of touched) {
        const ownerSf = project.getSourceFile(absoluteSourcePath)
        if (ownerSf !== undefined && ownerSf.getFullText() !== original) {
          ownerSf.replaceWithText(original)
        }
      }
    }
  })
}
