export const assertEqual = (actual: unknown, expected: unknown, label?: string): void => {
  const serialize = (value: unknown): string => JSON.stringify(value)
  if (serialize(actual) !== serialize(expected)) {
    const prefix = label === undefined ? '' : `${label}: `
    throw new Error(`${prefix}expected ${serialize(expected)}, got ${serialize(actual)}`)
  }
}

export const assert = (condition: boolean, label: string): void => {
  if (!condition) throw new Error(label)
}
