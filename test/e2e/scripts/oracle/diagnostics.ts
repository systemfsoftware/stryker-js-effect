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
