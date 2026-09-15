import { SOURCE_CONDITION, sourceExports, typesPathFor, withSourceFirst } from '@systemfsoftware/tsdown-config'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

type Entry = Record<string, string | undefined>

const deriveTypes = (
  value: string,
  ext: string,
): string => (value.endsWith('.mjs') ? `${value.slice(0, -4)}${ext}` : value)

const pathArb = fc.oneof(fc.stringMatching(/^[A-Za-z0-9/._-]*\.mjs$/), fc.string())
const dtsExtArb = fc.constantFrom('.d.ts', '.d.mts')

const entryArb = fc.record({
  [SOURCE_CONDITION]: fc.option(pathArb, { nil: undefined }),
  types: fc.option(pathArb, { nil: undefined }),
  default: pathArb,
})

const asEntry = (
  out: unknown,
): Entry | undefined => (typeof out === 'object' && out !== null ? (out as Entry) : undefined)

const sameKeys = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key) => right.includes(key))

const sameShape = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => sameShape(a[key], b[key]))
}

const withSourceArb = fc.record({ [SOURCE_CONDITION]: fc.option(pathArb, { nil: undefined }), default: pathArb })
const withTypesArb = fc.record({ types: pathArb, default: pathArb })

const manifestArb = fc.tuple(
  fc.option(fc.constant('./package.json'), { nil: undefined }),
  fc.dictionary(fc.string().map((stem) => `./${stem}`), entryArb, { minKeys: 1 }),
).map(([self, entries]): Record<string, string | Entry> => {
  const manifest: Record<string, string | Entry> = { ...entries }
  if (self !== undefined) manifest[self] = self
  return manifest
})

describe('typesPathFor', () => {
  it('∀ path, ext: exactly one trailing .mjs is swapped for ext, everything else is untouched', () => {
    fc.assert(fc.property(pathArb, dtsExtArb, (path, ext) => {
      const out = typesPathFor(ext, path)
      return path.endsWith('.mjs') ? out === `${path.slice(0, -4)}${ext}` : out === path
    }))
  })
})

describe('withSourceFirst', () => {
  it('∀ entry: key order is condition, types, default — the condition first whenever the entry carries it', () => {
    fc.assert(fc.property(entryArb, (entry) => {
      const out = asEntry(withSourceFirst(entry, '.d.mts'))
      if (out === undefined) return false
      const keys = Object.keys(out)
      const expected = entry[SOURCE_CONDITION] == null ? ['types', 'default'] : [SOURCE_CONDITION, 'types', 'default']
      return keys.length === expected.length && expected.every((key, index) => keys[index] === key)
    }))
  })

  it('∀ entry: carried values are conserved — the condition and the default pass through unchanged', () => {
    fc.assert(fc.property(entryArb, (entry) => {
      const out = asEntry(withSourceFirst(entry, '.d.mts'))
      return out !== undefined &&
        out[SOURCE_CONDITION] === entry[SOURCE_CONDITION] &&
        out['default'] === entry['default']
    }))
  })

  it('∀ entry without types: emitted types is the default with its trailing .mjs swapped for the dts extension', () => {
    fc.assert(fc.property(dtsExtArb, withSourceArb, (ext, entry) => {
      const out = asEntry(withSourceFirst(entry, ext))
      return out !== undefined && out['types'] === deriveTypes(entry['default'], ext)
    }))
  })

  it('∀ entry carrying types: the carried types are never re-derived', () => {
    fc.assert(fc.property(dtsExtArb, withTypesArb, (ext, entry) => {
      const out = asEntry(withSourceFirst(entry, ext))
      return out !== undefined && out['types'] === entry['types']
    }))
  })

  it('∀ path: a string entry is normalized to its derived types followed by the path itself', () => {
    fc.assert(fc.property(pathArb, dtsExtArb, (path, ext) => {
      const out = asEntry(withSourceFirst(path, ext))
      if (out === undefined) return false
      const keys = Object.keys(out)
      return keys.length === 2 &&
        keys[0] === 'types' &&
        keys[1] === 'default' &&
        out['types'] === deriveTypes(path, ext) &&
        out['default'] === path
    }))
  })
})

describe('sourceExports', () => {
  const config = sourceExports({ dtsExt: '.d.mts' })

  it('declares the source condition as devExports', () => {
    expect(config.devExports).toBe(SOURCE_CONDITION)
  })

  it('∀ manifest: the ./package.json self-reference is passed through untouched', () => {
    fc.assert(fc.property(fc.dictionary(fc.string().map((stem) => `./${stem}`), entryArb), (entries) => {
      const manifest = { ...entries, './package.json': './package.json' }
      return config.customExports(manifest)['./package.json'] === manifest['./package.json']
    }))
  })

  it('∀ manifest: mapping conserves the key set', () => {
    fc.assert(fc.property(manifestArb, (manifest) => {
      const out = config.customExports({ ...manifest })
      return sameKeys(Object.keys(manifest), Object.keys(out))
    }))
  })

  it('∀ manifest: every non-self entry is mapped under the entry laws with the configured dts extension', () => {
    fc.assert(fc.property(manifestArb, (manifest) => {
      const out = config.customExports({ ...manifest })
      for (const [key, value] of Object.entries(manifest)) {
        if (key === './package.json') continue
        if (typeof value === 'string') {
          const mapped = asEntry(out[key])
          if (mapped === undefined || mapped['types'] !== deriveTypes(value, '.d.mts') || mapped['default'] !== value) {
            return false
          }
          continue
        }
        const mapped = asEntry(out[key])
        if (mapped === undefined) return false
        const expectedKeys = value[SOURCE_CONDITION] == null
          ? ['types', 'default']
          : [SOURCE_CONDITION, 'types', 'default']
        const keys = Object.keys(mapped)
        if (keys.length !== expectedKeys.length || !expectedKeys.every((k, index) => keys[index] === k)) return false
        if (mapped[SOURCE_CONDITION] !== value[SOURCE_CONDITION] || mapped['default'] !== value['default']) return false
        if (mapped['types'] !== (value['types'] ?? deriveTypes(value['default'] ?? '', '.d.mts'))) return false
      }
      return true
    }))
  })

  it('∀ manifest: mapping twice equals mapping once', () => {
    fc.assert(fc.property(manifestArb, (manifest) => {
      const once = config.customExports({ ...manifest })
      return sameShape(once, config.customExports({ ...once }))
    }))
  })
})
