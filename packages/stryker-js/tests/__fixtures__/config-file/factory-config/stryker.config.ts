import { defineConfig } from '../../../../src/config/mod.js'

const THRESHOLD_HIGH: Record<string, number> = { machine: 97 }
const THRESHOLD_LOW: Record<string, number> = { run: 10 }

export default defineConfig((env) => ({
  thresholds: {
    high: THRESHOLD_HIGH[env.mode] ?? 98,
    low: THRESHOLD_LOW[env.command] ?? 20,
  },
}))
