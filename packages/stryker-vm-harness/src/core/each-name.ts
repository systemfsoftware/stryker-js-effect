/**
 * `test.each` / `describe.each` title formatting, ported from Vitest 5.0.1's
 * `formatTitle` (dist/chunks/run.*.js) together with the token formatter it
 * delegates to (`@vitest/utils/display`'s `format`), so a table row produces
 * the exact name Vitest generates for it.
 *
 * Faithful pieces: the `%[sdjifoOc%]` token set, where every matched token
 * consumes one row item — `%%` consumes too and renders `%` followed by the
 * item it consumed, `%c` consumes and renders nothing; the `%#`/`%$` pre-pass
 * (0-based `%#`, 1-based `%$`, `%%` escaped around it); the `%f` pre-pass that
 * renders negative NaN and negative zero as `-%f`; the `%`-character-count
 * guard (`consumed < count`), so a token the row cannot feed formats
 * `undefined` while a token past that count stays literal; `%d`/`%i`/`%f`
 * coercion through `Number`/`Number.parseInt(String(...))`; `%j` rendering
 * `undefined` for a value JSON cannot represent; and the `$`-attribute rules
 * (object attributes read the first row item, numeric keys read the row list,
 * `$name` on a non-object row stays literal, and a string value is truncated
 * rather than quoted).
 *
 * Object/array/non-primitive values render with Vitest's own display formatter
 * (`@vitest/utils/display`, resolved from the user's vitest install, 40-character
 * budget by default); that formatter stays injectable, and the fallback when the
 * module cannot be resolved is JSON.
 */

import { createRequire } from 'node:module'

export type EachValue = null | undefined | string | number | boolean | bigint | symbol | object

export type EachValueFormatter = (value: EachValue) => string

export const DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE = 40

interface VitestDisplay {
  readonly inspect: (value: EachValue, options?: { truncate?: number }) => string
}

const DISPLAY_SPECIFIER = '@vitest/utils/display'

const toDisplay = (loaded: object | null | undefined): VitestDisplay | undefined => {
  if (loaded === null || loaded === undefined || !('inspect' in loaded)) {
    return undefined
  }
  const inspect = loaded.inspect
  return typeof inspect === 'function'
    ? { inspect: inspect as VitestDisplay['inspect'] }
    : undefined
}

let resolvedDisplay: VitestDisplay | undefined
let displayResolved = false

const displayOf = (): VitestDisplay | undefined => {
  if (displayResolved) {
    return resolvedDisplay
  }
  displayResolved = true
  try {
    const requireHarness = createRequire(import.meta.url)
    const vitestPackageJson = requireHarness.resolve('vitest/package.json')
    const requireVitest = createRequire(vitestPackageJson)
    resolvedDisplay = toDisplay(requireVitest(DISPLAY_SPECIFIER) as object)
  } catch {
    resolvedDisplay = undefined
  }
  return resolvedDisplay
}

const FORMAT_TOKENS = /%[sdjifoOc%]/g
const ATTRIBUTE_TOKENS = /\$([$\p{ID_Continue}.]+)/gu
const ESCAPED_PERCENT = '__vitest_escaped_%__'

const isObjectValue = (value: EachValue): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNegativeZero = (value: EachValue): boolean => typeof value === 'number' && value === 0 && 1 / value < 0

const jsonFormatValue: EachValueFormatter = (value) => {
  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }
  if (isNegativeZero(value)) {
    return '-0'
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (typeof value === 'string') {
    return value
  }
  if (value === null || typeof value !== 'object') {
    return String(value)
  }
  return String(JSON.stringify(value))
}

export const defaultFormatValue = (value: EachValue, truncate?: number): string => {
  const display = displayOf()
  if (display === undefined) {
    return jsonFormatValue(value)
  }
  return display.inspect(value, { truncate: truncate ?? DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE })
}

const objectAttr = (source: EachValue, path: string, fallback: EachValue): EachValue => {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let result: EachValue = source
  for (const segment of segments) {
    result = (Object(result) as Record<string, EachValue>)[segment]
    if (result === undefined) {
      return fallback
    }
  }
  return result
}

const NAN_SIGN_BUFFER = new ArrayBuffer(8)

const isNegativeNaN = (value: EachValue): boolean => {
  if (typeof value !== 'number' || !Number.isNaN(value)) {
    return false
  }
  const f64 = new Float64Array(NAN_SIGN_BUFFER)
  f64[0] = value
  return (new Uint32Array(NAN_SIGN_BUFFER).at(1) ?? 0) >>> 31 === 1
}

const truncateString = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }
  let end = maxLength - 1
  const lead = value.charCodeAt(end - 1)
  if (lead >= 0xd800 && lead <= 0xdbff) {
    end -= 1
  }
  return `${value.slice(0, end)}…`
}

const signedFloatTemplate = (template: string, items: readonly EachValue[]): string => {
  let signed = template
  const occurrences = signed.match(/%f/g) ?? []
  for (const at of occurrences.keys()) {
    const value = items[at]
    const negativeNaN = isNegativeNaN(value)
    if (!negativeNaN && !isNegativeZero(value)) {
      continue
    }
    let occurrence = 0
    signed = signed.replace(/%f/g, (match) => {
      occurrence += 1
      return occurrence === at + 1 ? `-${match}` : match
    })
  }
  return signed
}

const escapedPercentTailOf = (value: EachValue, formatValue: EachValueFormatter): string =>
  value !== null && typeof value === 'object'
    ? ` ${formatValue(value)}`
    : ` ${typeof value === 'symbol' ? value.toString() : String(value)}`

interface StringCoercibleObject {
  readonly toString: () => string
}

const isStringCoercibleObject = (value: unknown): value is StringCoercibleObject =>
  value !== null &&
  typeof value === 'object' &&
  (Symbol.toPrimitive in value ||
    typeof Reflect.get(value, 'toString') === 'function' ||
    typeof Reflect.get(value, 'valueOf') === 'function')

const numericTextOf = (value: EachValue): string => {
  if (typeof value === 'string') {
    return value
  }
  if (
    typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'undefined'
  ) {
    return String(value)
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (isStringCoercibleObject(value)) {
    const coercible: StringCoercibleObject = value
    return String(coercible)
  }
  throw new TypeError('Cannot convert object to primitive value')
}

const formatTokenPair = (
  token: string,
  value: EachValue,
  formatValue: EachValueFormatter,
): string => {
  switch (token) {
    case '%%':
      return `%${escapedPercentTailOf(value, formatValue)}`
    case '%s': {
      if (typeof value === 'bigint') {
        return `${value.toString()}n`
      }
      if (isNegativeZero(value)) {
        return '-0'
      }
      if (value !== null && typeof value === 'object') {
        if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
          const custom = value as { toString: () => string }
          return custom.toString()
        }
        return formatValue(value)
      }
      return String(value)
    }
    case '%d': {
      if (typeof value === 'bigint') {
        return `${value}n`
      }
      if (typeof value === 'symbol') {
        return 'NaN'
      }
      return Number(value).toString()
    }
    case '%i': {
      if (typeof value === 'bigint') {
        return `${value.toString()}n`
      }
      return Number.parseInt(numericTextOf(value)).toString()
    }
    case '%f':
      return Number.parseFloat(numericTextOf(value)).toString()
    case '%o':
    case '%O':
      return formatValue(value)
    case '%c':
      return ''
    case '%j': {
      try {
        return String(JSON.stringify(value))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message.includes('circular structure') || message.includes('cyclic')) {
          return '[Circular]'
        }
        throw error
      }
    }
    default:
      return token
  }
}

const substituteAttributes = (
  segment: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
): string =>
  segment.replace(ATTRIBUTE_TOKENS, (match, key: string) => {
    const isArrayKey = /^\d+$/.test(key)
    const isObjectItem = isObjectValue(items[0])
    if (!isObjectItem && !isArrayKey) {
      return match
    }
    const arrayElement = isArrayKey ? objectAttr(items, key, undefined) : undefined
    const value = isObjectItem ? objectAttr(items[0], key, arrayElement) : arrayElement
    if (typeof value === 'string') {
      return truncateString(value, truncate)
    }
    return formatValue(value)
  })

export interface EachNameOptions {
  readonly index?: number | undefined
  readonly formatValue?: EachValueFormatter | undefined
  readonly truncate?: number | undefined
}

export const formatEachName = (
  template: string,
  row: EachValue,
  options?: EachNameOptions,
): string => {
  const index = options?.index ?? 0
  const truncate = options?.truncate ?? DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE
  const formatValue = options?.formatValue ?? ((value) => defaultFormatValue(value, truncate))
  const items: readonly EachValue[] = Array.isArray(row) ? row : [row]

  const indexed = template.includes('%#') || template.includes('%$')
    ? template
      .replace(/%%/g, ESCAPED_PERCENT)
      .replace(/%#/g, String(index))
      .replace(/%\$/g, String(index + 1))
      .replace(new RegExp(ESCAPED_PERCENT, 'g'), '%%')
    : template

  const count = indexed.split('%').length - 1
  const withSigns = indexed.includes('%f') ? signedFloatTemplate(indexed, items) : indexed
  let cursor = 0
  const next = (): EachValue => {
    const value = items[cursor]
    cursor += 1
    return value
  }

  let output = ''
  let lastIndex = 0
  for (const match of withSigns.matchAll(FORMAT_TOKENS)) {
    const at = match.index
    if (lastIndex < at) {
      output += substituteAttributes(withSigns.slice(lastIndex, at), items, formatValue, truncate)
    }
    const token = match[0]
    output += cursor < count ? formatTokenPair(token, next(), formatValue) : token
    lastIndex = at + token.length
  }
  if (lastIndex < withSigns.length) {
    output += substituteAttributes(withSigns.slice(lastIndex), items, formatValue, truncate)
  }
  return output
}
