import type { VmProjectConfig, VmVitestConfig } from '../vitest-config.schema.js'

export type { VmProjectConfig, VmVitestConfig }

export const VM_VITEST_BAG_KEY = 'vitest'

export interface VmTransformResult {
  readonly code: string
}

export interface VmVitestRuntime {
  readonly config: VmVitestConfig
  readonly projectFor: (testFile: string) => VmProjectConfig
  readonly transformSync: (code: string, id: string) => VmTransformResult | undefined
  readonly loadFileSync: (id: string) => VmTransformResult | undefined
  readonly resolveIdSync: (specifier: string, importer: string) => string | undefined
  readonly resolveSnapshotPathSync: (testPath: string) => string
  readonly close: () => Promise<void>
}
