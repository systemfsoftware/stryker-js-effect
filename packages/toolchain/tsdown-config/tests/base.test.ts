import { SOURCE_CONDITION, sourceExports, typesPathFor, withTypesFirst } from '@systemfsoftware/tsdown-config'
import { describe, expect, it } from 'vitest'

describe('typesPathFor', () => {
  it('rewrites the mjs extension to the given dts extension', () => {
    expect(typesPathFor('.d.ts', './dist/index.mjs')).toBe('./dist/index.d.ts')
    expect(typesPathFor('.d.mts', './dist/config/base.mjs')).toBe('./dist/config/base.d.mts')
  })

  it('leaves non-mjs paths untouched', () => {
    expect(typesPathFor('.d.ts', './package.json')).toBe('./package.json')
  })
})

describe('withTypesFirst', () => {
  it('turns a string entry into types before default', () => {
    expect(withTypesFirst('./dist/index.mjs', '.d.ts')).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.mjs',
    })
  })

  it('orders an object entry as types, source condition, default', () => {
    const entry = {
      default: './dist/index.mjs',
      [SOURCE_CONDITION]: './src/index.ts',
    }
    expect(Object.keys(withTypesFirst(entry, '.d.mts'))).toEqual(['types', SOURCE_CONDITION, 'default'])
  })

  it('keeps an explicit types path instead of deriving one', () => {
    const entry = { types: './dist/custom.d.mts', default: './dist/index.mjs' }
    const ordered = withTypesFirst(entry, '.d.mts')
    if (typeof ordered === 'string') throw new Error('expected an object entry')
    expect(ordered['types']).toBe('./dist/custom.d.mts')
  })

  it('drops an absent source condition key instead of writing undefined', () => {
    const entry = { types: './dist/index.d.ts', default: './dist/index.mjs' }
    expect(Object.keys(withTypesFirst(entry, '.d.ts'))).toEqual(['types', 'default'])
  })
})

describe('sourceExports', () => {
  it('declares the dev condition and reorders every entry', () => {
    const config = sourceExports({ dtsExt: '.d.mts' })
    expect(config.devExports).toBe(SOURCE_CONDITION)
    const reordered = config.customExports({
      '.': './dist/index.mjs',
      './package.json': './package.json',
    })
    expect(reordered['.']).toEqual({ types: './dist/index.d.mts', default: './dist/index.mjs' })
  })

  it('leaves the manifest self-reference untouched', () => {
    const config = sourceExports()
    const selfReference = './package.json'
    const reordered = config.customExports({ './package.json': selfReference })
    expect(reordered['./package.json']).toBe(selfReference)
  })
})
