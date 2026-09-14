import { describe, expect, it } from 'vitest'

import {
  array,
  declared,
  is,
  literal,
  literals,
  nonEmptyArray,
  nullable,
  optional,
  type Schema,
  string,
  struct,
  suspend,
  union,
  unknown,
  validate,
  VENDOR,
} from '../src/mod.js'

interface Nest {
  readonly type: 'nest'
  readonly inner: NestOrLeaf
}

interface Leaf {
  readonly type: 'leaf'
}

type NestOrLeaf = Nest | Leaf

const NestOrLeaf: Schema<NestOrLeaf> = suspend(
  (): Schema<NestOrLeaf> =>
    union([struct({ type: literal('nest'), inner: NestOrLeaf }), struct({ type: literal('leaf') })]),
  { maxDepth: 6 },
)

const chainOf = (depth: number): unknown => {
  let node: unknown = { type: 'leaf' }
  for (let level = 1; level < depth; level += 1) {
    node = { type: 'nest', inner: node }
  }
  return node
}

const upper = (text: string): string => text.toUpperCase()

const narrowed = (value: unknown): string | undefined => (is(string(), value) ? upper(value) : undefined)

describe('the published schema', () => {
  it('declares version 1 and this vendor', () => {
    expect(string()['~standard'].version).toBe(1)
    expect(string()['~standard'].vendor).toBe(VENDOR)
  })
})

describe('struct', () => {
  it('accepts unexpected extra properties', () => {
    expect(is(struct({ name: string() }), { name: 'kept', host: 'extra' })).toBe(true)
  })

  it('rejects a declared key of the wrong type', () => {
    expect(is(struct({ name: string() }), { name: 1 })).toBe(false)
  })

  it('rejects an object missing a declared key', () => {
    expect(is(struct({ name: string() }), {})).toBe(false)
  })

  it('rejects a value that is not an object', () => {
    expect(is(struct({ name: string() }), 'name')).toBe(false)
  })
})

describe('union', () => {
  it('accepts a value the first member matches', () => {
    expect(is(union([literal('a'), string()]), 'a')).toBe(true)
  })

  it('accepts a value only a later member matches', () => {
    expect(is(union([literal('a'), string()]), 'z')).toBe(true)
  })

  it('rejects a value no member matches', () => {
    expect(is(union([literal('a'), literal('b')]), 'c')).toBe(false)
  })
})

describe('literals', () => {
  it('accepts a listed value', () => {
    expect(is(literals(['identifier', 'description']), 'description')).toBe(true)
  })

  it('rejects an unlisted value', () => {
    expect(is(literals(['identifier', 'description']), 'title')).toBe(false)
  })
})

describe('optional', () => {
  it('accepts an absent key', () => {
    expect(is(struct({ name: string(), note: optional(string()) }), { name: 'kept' })).toBe(true)
  })

  it('rejects a present key of the wrong type', () => {
    expect(is(struct({ name: string(), note: optional(string()) }), { name: 'kept', note: 1 })).toBe(false)
  })
})

describe('nullable', () => {
  it('accepts null', () => {
    expect(is(nullable(string()), null)).toBe(true)
  })

  it('rejects undefined', () => {
    expect(is(nullable(string()), undefined)).toBe(false)
  })
})

describe('array', () => {
  it('accepts an empty array', () => {
    expect(is(array(string()), [])).toBe(true)
  })

  it('rejects a value that is not an array', () => {
    expect(is(array(string()), 'kept')).toBe(false)
  })
})

describe('nonEmptyArray', () => {
  it('rejects an empty array', () => {
    expect(is(nonEmptyArray(string()), [])).toBe(false)
  })

  it('accepts a populated array of declared elements', () => {
    expect(is(nonEmptyArray(string()), ['kept'])).toBe(true)
  })

  it('rejects an array carrying a wrong-typed element', () => {
    expect(is(nonEmptyArray(string()), ['kept', 1])).toBe(false)
  })
})

describe('unknown', () => {
  it('accepts every value', () => {
    expect(is(unknown(), undefined)).toBe(true)
    expect(is(unknown(), null)).toBe(true)
    expect(is(unknown(), Number.NaN)).toBe(true)
  })
})

describe('declared', () => {
  const isSymbol = (value: unknown): value is symbol => typeof value === 'symbol'

  it('accepts a value the predicate proves', () => {
    expect(is(declared(isSymbol), Symbol('kept'))).toBe(true)
  })

  it('rejects a value the predicate refuses', () => {
    expect(is(declared(isSymbol), 'kept')).toBe(false)
  })
})

describe('suspend', () => {
  it('accepts a chain at the budget', () => {
    expect(is(NestOrLeaf, chainOf(6))).toBe(true)
  })

  it('rejects a chain past the budget', () => {
    expect(is(NestOrLeaf, chainOf(7))).toBe(false)
  })

  it('reports issues past the budget instead of descending further', () => {
    expect(validate(NestOrLeaf, chainOf(7)).issues).toBeDefined()
  })

  it('restores the budget after a rejected chain', () => {
    validate(NestOrLeaf, chainOf(7))
    expect(is(NestOrLeaf, chainOf(6))).toBe(true)
  })
})

describe('is', () => {
  it('narrows a value the schema accepts', () => {
    expect(narrowed('kept')).toBe('KEPT')
  })

  it('refuses a value the schema rejects', () => {
    expect(narrowed(1)).toBeUndefined()
  })
})

describe('validate', () => {
  it('reports no issues for an accepted value', () => {
    expect(validate(string(), 'kept').issues).toBeUndefined()
  })

  it('reports the issues of a rejected value', () => {
    expect(validate(string(), 1).issues).toBeDefined()
  })
})
