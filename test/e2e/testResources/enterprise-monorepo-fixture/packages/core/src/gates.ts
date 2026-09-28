export interface FeatureConfig {
  readonly enabled: boolean
  readonly canaryPercent: number
  readonly region?: string
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
export const isLaunchable = (config: FeatureConfig): boolean => config.enabled && config.canaryPercent > 0

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const gateFor = (config: FeatureConfig): string => {
  if (!config.enabled) {
    return 'disabled'
  }
  if (config.canaryPercent >= 100) {
    return 'full'
  }
  return 'canary'
}

// @stryker-expect next-line CompileError(TS2554): ArrowFunction
// @stryker-expect next-line CompileError(TS2322): LogicalOperator
export const regionLabel = (config: FeatureConfig): string => config.region ?? 'global'

// @stryker-expect next-line CompileError(TS2355): BlockStatement
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
  // @stryker-expect next-line Survived: BlockStatement="{}"
): TypedPropertyDescriptor<T> | void {
  // @stryker-expect next-line CompileError(TS2684): ConditionalExpression, LogicalOperator
  // @stryker-expect next-line CompileError(TS18048): EqualityOperator
  // @stryker-expect next-line CompileError(TS2367): StringLiteral
  // @stryker-expect next-line Survived: BlockStatement="{}"
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

  // @stryker-expect next-line CompileError(TS2564): BlockStatement
  constructor(salt: string) {
    this.#secretSalt = salt
  }

  // @stryker-expect next-line CompileError(TS2355): BlockStatement
  #computeHash(value: string): string {
    return `${this.#secretSalt}:${value}`
  }

  @auditAction
  // @stryker-expect next-line CompileError(TS2355): BlockStatement
  authenticate(token: string, attempts: number): boolean {
    if (attempts > this.#maxAttempts) {
      return false
    }
    const expected = this.#computeHash('authorized')
    return token === expected
  }
}

// @stryker-expect file KilledOrTimeout: all
