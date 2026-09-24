import { readFileSync } from 'node:fs'

import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const customText = (): Plugin => ({
  name: 'vm-parity-custom-text',
  load(id) {
    if (!id.endsWith('.custom')) {
      return undefined
    }
    const raw = readFileSync(id, 'utf8').trim()
    return { code: `export default ${JSON.stringify(raw)}`, map: null }
  },
})

export default defineConfig({
  plugins: [customText()],
  oxc: {
    jsx: {
      runtime: 'classic',
      pragma: 'h',
      pragmaFrag: 'Fragment',
    },
  },
  test: {
    css: true,
  },
})
