export interface FeatureConfig {
  readonly enabled: boolean
  readonly canaryPercent: number
  readonly region?: string
}

export const isLaunchable = (config: FeatureConfig): boolean => config.enabled && config.canaryPercent > 0

export const gateFor = (config: FeatureConfig): string => {
  if (!config.enabled) {
    return 'disabled'
  }
  if (config.canaryPercent >= 100) {
    return 'full'
  }
  return 'canary'
}

export const regionLabel = (config: FeatureConfig): string => config.region ?? 'global'

export const shouldSample = (config: FeatureConfig, seed: number): boolean => {
  if (!config.enabled || seed % 2 === 1) {
    return false
  }
  return seed < config.canaryPercent
}
