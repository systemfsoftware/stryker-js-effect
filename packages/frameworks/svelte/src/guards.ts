export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isString = (value: unknown): value is string => typeof value === 'string'

export const isFunction = (value: unknown): value is (...args: readonly never[]) => unknown =>
  typeof value === 'function'

export const isNonEmptyArray = (value: unknown): value is readonly unknown[] => Array.isArray(value) && value.length > 0

export const isFilled = (value: unknown): value is string => isString(value) && value.length > 0
