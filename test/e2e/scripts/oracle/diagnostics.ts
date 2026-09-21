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

export function evaluateWithProjects(
  projects: readonly PackageProject[],
  sourcePath: string,
  sourceText: string,
  mutants: readonly IndependentMutant[],
): readonly IndependentMutant[] {
  const absoluteSourcePath = path.resolve(sourcePath)

  return mutants.map((m) => {
    if (m.status === 'Ignored') {
      return m
    }
    const mutated = sourceText.slice(0, m.start) + m.replacement + sourceText.slice(m.end)

    for (const entry of projects) {
      const ownerSf = entry.project.getSourceFile(absoluteSourcePath) ??
        entry.project.getSourceFiles().find((sf) => {
          const fp = sf.getFilePath()
          return fp === absoluteSourcePath ||
            fp.replace(/\//g, path.sep) === absoluteSourcePath.replace(/\//g, path.sep)
        }) ??
        entry.project.createSourceFile(absoluteSourcePath, mutated, { overwrite: true })

      if (ownerSf.getFullText() !== mutated) {
        ownerSf.replaceWithText(mutated)
      }
    }

    const errorDiag = projects
      .flatMap((entry) => entry.project.getPreEmitDiagnostics())
      .find((d) => d.getCategory() === 1)

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
  })
}
