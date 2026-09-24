import { describe, it } from '@effect/vitest'
import { expect } from 'vitest'

import { replaceCodeToken } from '../code-rewrite.js'

const VIEW = 'Object.assign(globalThis.__vitest_worker__?.metaEnv ?? import.meta.env)'

const rewritten = (source: string): string => replaceCodeToken(source, 'import.meta.env', VIEW).code

describe('replaceCodeToken', () => {
  it('keeps an assignment to the token untouched', () => {
    expect(rewritten('import.meta.env = { MODE: "test" }')).toBe('import.meta.env = { MODE: "test" }')
    expect(rewritten('import.meta.env += extra')).toBe('import.meta.env += extra')
  })

  it('rewrites comparisons, reads, and handed-around references', () => {
    expect(rewritten('import.meta.env == other')).toBe(`${VIEW} == other`)
    expect(rewritten('import.meta.env === other')).toBe(`${VIEW} === other`)
    expect(rewritten('(x) => import.meta.env')).toBe(`(x) => ${VIEW}`)
    expect(rewritten('const e = import.meta.env')).toBe(`const e = ${VIEW}`)
  })

  it('rewrites the object of a member assignment and read', () => {
    expect(rewritten('import.meta.env.X = 1')).toBe(`${VIEW}.X = 1`)
    expect(rewritten('const x = import.meta.env.X')).toBe(`const x = ${VIEW}.X`)
  })
})
