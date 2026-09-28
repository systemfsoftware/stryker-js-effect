import { dual } from 'effect/Function'
import * as path from 'node:path'
import { Project } from 'ts-morph'
import type { IndependentMutant } from './types.js'

interface Diagnosticish {
  getCode(): number
  getSourceFile(): { getFilePath(): string } | undefined
  getMessageText(): string | { toString(): string }
  getCategory(): number
}

const messageTextOf = (diagnostic: Diagnosticish): string => {
  const text = diagnostic.getMessageText()
  return typeof text === 'string' ? text : text.toString()
}

const determineCompileErrorsWithDiagnosticsDataFirst = (
  sourceText: string,
  mutants: readonly IndependentMutant[],
): readonly IndependentMutant[] => {
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
    if (errorDiag !== undefined) {
      return {
        ...m,
        compileError: {
          code: errorDiag.getCode(),
          message: messageTextOf(errorDiag),
        },
      }
    }
    return m
  })
}

export const determineCompileErrorsWithDiagnostics: {
  (sourceText: string, mutants: readonly IndependentMutant[]): readonly IndependentMutant[]
  (mutants: readonly IndependentMutant[]): (sourceText: string) => readonly IndependentMutant[]
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'string',
  determineCompileErrorsWithDiagnosticsDataFirst,
)

export interface PackageProject {
  readonly packageDir: string
  readonly tsConfigPath: string
  readonly project: Project
  readonly fileNames: ReadonlySet<string>
}

interface DiagnosticKeyIndex {
  readonly keys: ReadonlySet<string>
}

const cleanDiagnosticIndex = new WeakMap<readonly PackageProject[], DiagnosticKeyIndex>()

function diagnosticKey(d: Diagnosticish): string {
  return `${d.getCode()}|${d.getSourceFile()?.getFilePath() ?? ''}|${messageTextOf(d)}`
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

const evaluateWithProjectsDataFirst = (
  projects: readonly PackageProject[],
  sourcePath: string,
  sourceText: string,
  mutants: readonly IndependentMutant[],
): readonly IndependentMutant[] => {
  const absoluteSourcePath = path.resolve(sourcePath)
  const owners = owningProjectsOf(projects, absoluteSourcePath)
  if (owners.length === 0) {
    return mutants
  }
  const cleanKeys = cleanErrorKeys(projects)

  return mutants.map((m) => {
    if (m.status === 'Ignored') {
      return m
    }
    const mutated = sourceText.slice(0, m.start) + m.replacement + sourceText.slice(m.end)
    return withMutatedSource(owners, absoluteSourcePath, mutated, (diagnostics) => {
      const errorDiag = diagnostics.find((d) => !cleanKeys.has(diagnosticKey(d)))
      return errorDiag === undefined ? m : {
        ...m,
        compileError: {
          code: errorDiag.getCode(),
          message: messageTextOf(errorDiag),
        },
      }
    })
  })
}

export const evaluateWithProjects: {
  (
    projects: readonly PackageProject[],
    sourcePath: string,
    sourceText: string,
    mutants: readonly IndependentMutant[],
  ): readonly IndependentMutant[]
  (
    sourcePath: string,
    sourceText: string,
    mutants: readonly IndependentMutant[],
  ): (projects: readonly PackageProject[]) => readonly IndependentMutant[]
} = dual((args: IArguments): boolean => Array.isArray(args[0]), evaluateWithProjectsDataFirst)

const normalizePath = (filePath: string): string => filePath.split(path.sep).join('/')

const owningProjectsOf = (
  projects: readonly PackageProject[],
  absoluteSourcePath: string,
): readonly PackageProject[] => {
  const owned = normalizePath(path.resolve(absoluteSourcePath))
  return projects.filter((entry) => entry.fileNames.has(owned))
}

const errorDiagnosticsOf = (owners: readonly PackageProject[]): readonly Diagnosticish[] =>
  owners.flatMap((entry) => entry.project.getPreEmitDiagnostics()).filter((d) => d.getCategory() === 1)

function withMutatedSource<A>(
  owners: readonly PackageProject[],
  absoluteSourcePath: string,
  mutated: string,
  read: (diagnostics: readonly Diagnosticish[]) => A,
): A {
  const touched = new Map<Project, string>()

  for (const entry of owners) {
    const ownerSf = entry.project.getSourceFile(absoluteSourcePath)
    if (ownerSf === undefined) continue
    if (!touched.has(entry.project)) {
      touched.set(entry.project, ownerSf.getFullText())
    }
    if (ownerSf.getFullText() !== mutated) {
      ownerSf.replaceWithText(mutated)
    }
  }

  try {
    return read(errorDiagnosticsOf(owners))
  } finally {
    for (const [project, original] of touched) {
      const ownerSf = project.getSourceFile(absoluteSourcePath)
      if (ownerSf !== undefined && ownerSf.getFullText() !== original) {
        ownerSf.replaceWithText(original)
      }
    }
  }
}
