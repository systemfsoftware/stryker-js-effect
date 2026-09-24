import { sourceExports } from '@systemfsoftware/tsdown-config'
import { defineConfig } from 'tsdown'

type ExportsMap = Record<string, string | Record<string, string>>

const generated = sourceExports({ dtsExt: '.d.mts' })

export default defineConfig({
  entry: {
    index: './src/index.ts',
    worker: './src/shell/worker-entry.ts',
    'vitest-host-worker': './src/shell/vitest-host/host-thread.ts',
  },
  format: 'esm',
  dts: true,
  exports: {
    ...generated,
    customExports: (exports: ExportsMap): ExportsMap => {
      const mapped = generated.customExports(exports)
      for (const entry of ['./worker', './vitest-host-worker']) {
        const target = mapped[entry]
        if (typeof target === 'object' && target !== null) {
          delete target['@systemfsoftware/source']
        }
      }
      return mapped
    },
  },
  clean: true,
  define: { 'import.meta.vitest': 'undefined' },
})
