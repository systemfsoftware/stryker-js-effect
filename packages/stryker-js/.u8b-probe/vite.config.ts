import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['u8b-merge.tmp.test.ts'], environment: 'node', globals: true } })
