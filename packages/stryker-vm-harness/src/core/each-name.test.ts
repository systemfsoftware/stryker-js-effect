import { describe, expect, it } from 'vitest'
import { formatEachName } from './each-name.js'

describe('formatEachName', () => {
  it('formats %i as integer', () => {
    expect(formatEachName('value: %i', [42.7])).toBe('value: 42')
  })

  it('formats %d as number and %f as float', () => {
    expect(formatEachName('num: %d', [123])).toBe('num: 123')
    expect(formatEachName('num: %d', ['123.450'])).toBe('num: 123.45')
    expect(formatEachName('num: %d', ['not-a-number'])).toBe('num: NaN')
    expect(formatEachName('float: %f', [3.14159])).toBe('float: 3.14159')
    expect(formatEachName('float: %f', ['3.140'])).toBe('float: 3.14')
  })

  it('formats %j as json', () => {
    expect(formatEachName('obj: %j', [{ a: 1 }])).toBe('obj: {"a":1}')
    expect(formatEachName('null: %j', [null])).toBe('null: null')
    expect(formatEachName('str: %j', ['plain'])).toBe('str: "plain"')
  })

  it('formats non-matching %tokens without consuming input', () => {
    expect(formatEachName('val: %D %F %s', ['a'])).toBe('val: %D %F a')
  })

  it('formats %# as index', () => {
    expect(formatEachName('case %#', ['a'])).toBe('case 1')
  })

  it('escapes %% as %', () => {
    expect(formatEachName('100%% %s', ['done'])).toBe('100% done')
  })

  it('interpolates $var and ${var}', () => {
    expect(formatEachName('$foo and ${bar}', { foo: 'hello', bar: 'world' })).toBe('hello and world')
  })
  it('formats null and undefined in template', () => {
    expect(formatEachName('val: %s', [null])).toBe('val: null')
    expect(formatEachName('val: %s', [undefined])).toBe('val: undefined')
    expect(formatEachName('val: %j', [null])).toBe('val: null')
  })

  it('formats object with default %s token', () => {
    expect(formatEachName('val: %s', [{ x: 2 }])).toBe('val: {"x":2}')
  })

  it('formats non-array row', () => {
    expect(formatEachName('val: %s', 'single')).toBe('val: single')
  })

  it('returns empty string for missing property in template interpolation', () => {
    expect(formatEachName('$missing', {})).toBe('')
  })
})
