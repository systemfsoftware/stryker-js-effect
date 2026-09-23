import type { FrameworkContribution } from '@systemfsoftware/stryker-framework-interface'
import { VERSION } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

import { strykerFrameworks } from '../src/mod.js'

describe('svelte plugin entry', () => {
  it('Exports_The_Svelte_Framework_With_The_Installed_Compiler_Version', () => {
    const contribution: FrameworkContribution | undefined = strykerFrameworks.at(0)
    if (contribution?.kind !== 'Framework') {
      throw new Error('expected the svelte framework')
    }
    expect(contribution.name).toBe('svelte')
    expect(contribution.claim).toStrictEqual({
      formatId: 'svelte',
      extensions: ['.svelte'],
      language: 'svelte',
      ownerVersion: VERSION,
      contractVersion: '1',
    })
  })

  it('Exports_Exactly_One_Contribution', () => {
    expect(strykerFrameworks.length).toBe(1)
  })
})
