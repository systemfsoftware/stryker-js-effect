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
  if (!config.enabled) {
    return false
  }
  return seed < config.canaryPercent
}

export function auditAction<T extends Function>(
  _target: unknown,
  _propertyKey?: string | symbol,
  descriptor?: TypedPropertyDescriptor<T>,
): TypedPropertyDescriptor<T> | void {
  if (descriptor && typeof descriptor.value === 'function') {
    const original = descriptor.value
    descriptor.value = function(this: unknown, ...args: unknown[]) {
      return original.apply(this, args)
    } as unknown as T
    return descriptor
  }
}

export class Gatekeeper {
  readonly #secretSalt: string
  readonly #maxAttempts = 3

  constructor(salt: string) {
    this.#secretSalt = salt
  }

  #computeHash(value: string): string {
    return `${this.#secretSalt}:${value}`
  }

  @auditAction
  authenticate(token: string, attempts: number): boolean {
    if (attempts > this.#maxAttempts) {
      return false
    }
    const expected = this.#computeHash('authorized')
    return token === expected
  }
}
