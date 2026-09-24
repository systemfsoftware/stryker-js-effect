import { describe, it } from '@effect/vitest'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SOURCE_DIR = '/tmp/refactor/baseline/packages/stryker-js/src'

describe('scratch baseline import', () => {
  it('imports baseline glob-match source via file url', async () => {
    const url = pathToFileURL(`${SOURCE_DIR}/glob-match.ts`).href
    console.log('exists', existsSync(`${SOURCE_DIR}/glob-match.ts`), url)
    const mod = await import(/* @vite-ignore */ url)
    console.log('keys', Object.keys(mod))
    console.log('isGlob', mod.isGlob('a*b'), mod.compileIgnoreRule('!**/*.spec.ts').negate)
  })
})