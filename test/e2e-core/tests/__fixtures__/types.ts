export type StaticMutantStatus = 'Active' | 'Ignored'

export type ExecutionMutantStatus = 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'RuntimeError'

export interface IndependentMutant {
  readonly line: number
  readonly mutatorName: string
  readonly replacement: string
  readonly start: number
  readonly end: number
  readonly status: StaticMutantStatus
  readonly compileError?: { readonly code: number; readonly message: string }
}

export interface IndependentInventory {
  readonly mutants: readonly IndependentMutant[]
  readonly mutatorTally: Readonly<Record<string, number>>
  readonly activeCount: number
  readonly ignoredCount: number
}

export interface DirectiveRule {
  readonly type: 'disable' | 'restore'
  readonly scope?: 'next-line'
  readonly targetMutators: readonly string[]
  readonly line: number
}
