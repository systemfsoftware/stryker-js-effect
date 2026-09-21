import * as Predicate from 'effect/Predicate'

const propertyOf = (row: unknown, key: string): unknown => {
  if (!Predicate.isObject(row)) {
    return undefined
  }
  return Object.getOwnPropertyDescriptor(row, key)?.value
}

const templateValue = (row: unknown, key: string): string => {
  const value = propertyOf(row, key)
  if (value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return JSON.stringify(value)
}

export const formatEachName = (template: string, row: unknown): string => {
  const values: ReadonlyArray<unknown> = Array.isArray(row) ? row : [row]
  let index = 0
  const next = (): unknown => {
    const value = values[index]
    index += 1
    return value
  }
  return template
    .replace(/%[\difjs#%]/g, (token) => {
      if (token === '%%') {
        return '%'
      }
      const value = next()
      if (token === '%i') {
        return String(parseInt(String(value), 10))
      }
      if (token === '%f' || token === '%d') {
        return String(parseFloat(String(value)))
      }
      if (token === '%j') {
        return JSON.stringify(value)
      }
      if (token === '%#') {
        return String(index)
      }
      return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    })
    .replace(/\$\{([^}]+)\}/g, (_match, key: string) => templateValue(row, key))
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key: string) => templateValue(row, key))
}
