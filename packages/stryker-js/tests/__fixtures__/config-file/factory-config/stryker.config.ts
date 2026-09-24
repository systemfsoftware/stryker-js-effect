import { StrykerConfig } from '../../../../src/config/mod.js'

const THRESHOLD_HIGH: Record<string, number> = { machine: 97 }
const THRESHOLD_LOW: Record<string, number> = { run: 10 }

export default StrykerConfig.define((env) => ({
  thresholds: {
    high: THRESHOLD_HIGH[env.mode] ?? 98,
    low: THRESHOLD_LOW[env.command] ?? 20,
  },
}))
