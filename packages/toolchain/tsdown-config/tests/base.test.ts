import { SOURCE_CONDITION, sourceExports, typesPathFor, withSourceFirst } from '@systemfsoftware/tsdown-config'
import { describe, it } from '@systemfsoftware/vitest'
import { Schema as S } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

type Entry = Record<string, string | undefined>

const deriveTypes = (
  value: string,
  ext: string,
): string => (value.endsWith('.mjs') ? `${value.slice(0, -4)}${ext}` : value)

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

const MjsPath = S.String.check(S.isPattern(/^[A-Za-z0-9/._-]*\.mjs$/))

const pathArb = Arbitrary.flatMap(
  Arbitrary.schema(S.Boolean),
  (preferMjs): Arbitrary.Arbitrary<string> => (preferMjs ? Arbitrary.schema(MjsPath) : Arbitrary.schema(S.String)),
)

const dtsExtArb = Arbitrary.schema(S.Literals(['.d.ts', '.d.mts']))

const optional = <A>(arbitrary: Arbitrary.Arbitrary<A>): Arbitrary.Arbitrary<A | undefined> =>
  Arbitrary.flatMap(Arbitrary.schema(S.Boolean), (present) => (present ? arbitrary : Arbitrary.Constant(undefined)))

const entryArb = Arbitrary.all({
  [SOURCE_CONDITION]: optional(pathArb),
  types: optional(pathArb),
  default: pathArb,
})
const withSourceArb = Arbitrary.all({ [SOURCE_CONDITION]: optional(pathArb), default: pathArb })
const withTypesArb = Arbitrary.all({ types: pathArb, default: pathArb })

const asManifest = <A>(pairs: ReadonlyArray<readonly [string, A]>): Record<string, A> => Object.fromEntries(pairs)

const manifestArb = Arbitrary.map(
  Arbitrary.array(Arbitrary.all([Arbitrary.schema(S.String), entryArb]), { minLength: 1 }),
  asManifest,
)

const manifestWithOptionalSelfArb = Arbitrary.flatMap(
  Arbitrary.schema(S.Boolean),
  (withSelf): Arbitrary.Arbitrary<Record<string, Entry | string>> =>
    withSelf
      ? Arbitrary.map(manifestArb, (manifest) => ({ ...manifest, './package.json': './package.json' }))
      : manifestArb,
)

describe('typesPathFor', () => {
  it.prop(
    '∀ path, ext: exactly one trailing .mjs is swapped for ext, everything else is untouched',
    { of: [pathArb, dtsExtArb], subject: typesPathFor },
    (subject, [path, ext]) => {
      const out = subject(ext, path)
      return path.endsWith('.mjs') ? out === `${path.slice(0, -4)}${ext}` : out === path
    },
  )
})

describe('withSourceFirst', () => {
  it.prop(
    '∀ entry: key order is condition, types, default — the condition first whenever the entry carries it',
    { of: [entryArb], subject: withSourceFirst },
    (subject, [entry]) => {
      const out = asEntry(subject(entry, '.d.mts'))
      if (out === undefined) return false
      const keys = Object.keys(out)
      const expected = entry[SOURCE_CONDITION] == null ? ['types', 'default'] : [SOURCE_CONDITION, 'types', 'default']
      return keys.length === expected.length && expected.every((key, index) => keys[index] === key)
    },
  )

  it.prop(
    '∀ entry: carried values are conserved — the condition and the default pass through unchanged',
    { of: [entryArb], subject: withSourceFirst },
    (subject, [entry]) => {
      const out = asEntry(subject(entry, '.d.mts'))
      return out !== undefined &&
        out[SOURCE_CONDITION] === entry[SOURCE_CONDITION] &&
        out['default'] === entry['default']
    },
  )

  it.prop(
    '∀ entry without types: emitted types is the default with its trailing .mjs swapped for the dts extension',
    { of: [dtsExtArb, withSourceArb], subject: withSourceFirst },
    (subject, [ext, entry]) => {
      const out = asEntry(subject(entry, ext))
      return out !== undefined && out['types'] === deriveTypes(entry['default'], ext)
    },
  )

  it.prop(
    '∀ entry carrying types: the carried types are never re-derived',
    { of: [dtsExtArb, withTypesArb], subject: withSourceFirst },
    (subject, [ext, entry]) => {
      const out = asEntry(subject(entry, ext))
      return out !== undefined && out['types'] === entry['types']
    },
  )

  it.prop(
    '∀ path: a string entry is normalized to its derived types followed by the path itself',
    { of: [pathArb, dtsExtArb], subject: withSourceFirst },
    (subject, [path, ext]) => {
      const out = asEntry(subject(path, ext))
      if (out === undefined) return false
      const keys = Object.keys(out)
      return keys.length === 2 &&
        keys[0] === 'types' &&
        keys[1] === 'default' &&
        out['types'] === deriveTypes(path, ext) &&
        out['default'] === path
    },
  )
})

describe('sourceExports', () => {
  const config = sourceExports({ dtsExt: '.d.mts' })

  it('declares the source condition as devExports', function*({ expect }) {
    yield* expect(config.devExports).toBe(SOURCE_CONDITION)
  })

  it.prop(
    '∀ manifest: the ./package.json self-reference is passed through untouched',
    { of: [manifestArb], subject: config.customExports },
    (subject, [manifest]) => {
      const withSelf = { ...manifest, './package.json': './package.json' }
      return subject(withSelf)['./package.json'] === withSelf['./package.json']
    },
  )

  it.prop(
    '∀ manifest: mapping conserves the key set',
    { of: [manifestWithOptionalSelfArb], subject: config.customExports },
    (subject, [manifest]) => sameKeys(Object.keys(manifest), Object.keys(subject({ ...manifest }))),
  )

  it.prop(
    '∀ manifest: every non-self entry is mapped under the entry laws with the configured dts extension',
    { of: [manifestWithOptionalSelfArb], subject: config.customExports },
    (subject, [manifest]) => {
      const out = subject({ ...manifest })
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
    },
  )

  it.prop(
    '∀ manifest: mapping twice equals mapping once',
    { of: [manifestWithOptionalSelfArb], subject: config.customExports },
    (subject, [manifest]) => {
      const once = subject({ ...manifest })
      return sameShape(once, subject({ ...once }))
    },
  )
})
