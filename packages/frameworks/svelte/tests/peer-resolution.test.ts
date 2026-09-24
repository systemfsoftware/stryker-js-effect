import type { Framework, FrameworkContribution, FrameworkRefusal } from '@systemfsoftware/stryker-framework-interface'
import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }
import { strykerFrameworks } from '../src/mod.js'
import { COMPILER_SPECIFIER, contributionOf, loadPeer, type PeerLoad, SUPPORTED_RANGE } from '../src/peer.js'
import * as shapeless from './__fixtures__/peer-shapeless.mjs'
import * as stranger from './__fixtures__/peer-stranger.mjs'
import * as five from './__fixtures__/peer-svelte-five.mjs'
import * as four from './__fixtures__/peer-svelte-four.mjs'
import * as six from './__fixtures__/peer-svelte-six.mjs'

const MISSING_SPECIFIER = './__fixtures__/peer-absent.mjs'

const loaded = (module: unknown): () => Promise<PeerLoad> => async () => ({ kind: 'Loaded', module })

const refusalOf = (contribution: FrameworkContribution): FrameworkRefusal => {
  if (contribution.kind !== 'FrameworkRefusal') {
    throw new Error('expected a refusal')
  }
  return contribution
}

const frameworkOf = (contribution: FrameworkContribution): Framework => {
  if (contribution.kind !== 'Framework') {
    throw new Error('expected a framework')
  }
  return contribution
}

describe('svelte peer loading', () => {
  it('loads the peer the package names through a dynamic import', async () => {
    const loadedPeer = await loadPeer(COMPILER_SPECIFIER)
    if (loadedPeer.kind !== 'Loaded') {
      throw new Error('the installed svelte compiler must load')
    }
    expect(typeof Reflect.get(loadedPeer.module as object, 'VERSION')).toBe('string')
  })

  it('answers Missing for a specifier that does not resolve', async () => {
    expect(await loadPeer(MISSING_SPECIFIER)).toStrictEqual({ kind: 'Missing' })
  })

  it('propagates an import failure that carries no error code', async () => {
    await expect(loadPeer('../tests/__fixtures__/peer-rejecting-value.mjs')).rejects.toBe(
      'the peer module rejected with a bare value',
    )
  })

  it('propagates an import failure with an unrelated error code', async () => {
    await expect(contributionOf(() => loadPeer('../tests/__fixtures__/peer-rejecting-error.mjs'))).rejects.toThrow(
      'the peer module failed while evaluating',
    )
  })

  it('reports an unresolved peer through the shared contribution decision', async () => {
    expect(refusalOf(await contributionOf(() => loadPeer(MISSING_SPECIFIER)))).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerMissing',
      peer: 'svelte',
      detail: 'the "svelte" peer is not installed',
    })
  })
})

describe('svelte peer decisions', () => {
  it('declares the same range the manifest peers on', () => {
    expect(SUPPORTED_RANGE).toBe(manifest.peerDependencies.svelte)
    expect(SUPPORTED_RANGE).toBe('^5.0.0')
  })

  it('serves a framework for the 5.x fixture compiler', async () => {
    const framework = frameworkOf(await contributionOf(loaded(five)))
    expect(framework.name).toBe('svelte')
    expect(framework.claim.ownerVersion).toBe('5.0.0')
  })

  it('refuses the 4.x fixture compiler with the installed version and the supported range', async () => {
    expect(refusalOf(await contributionOf(loaded(four)))).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerVersionUnsupported',
      peer: 'svelte',
      detail: 'svelte 4.2.19 is not supported (expected ^5.0.0)',
    })
  })

  it('refuses the 6.x fixture compiler with the installed version and the supported range', async () => {
    expect(refusalOf(await contributionOf(loaded(six)))).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerVersionUnsupported',
      peer: 'svelte',
      detail: 'svelte 6.0.0-next.1 is not supported (expected ^5.0.0)',
    })
  })

  it('refuses a module that exports no compiler surface as unrecognized', async () => {
    expect(refusalOf(await contributionOf(loaded(shapeless)))).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerUnrecognized',
      peer: 'svelte',
      detail: 'the "svelte/compiler" module must export a VERSION string and a parse function',
    })
  })

  it('refuses a version that is not a string and a parse that is not a function as unrecognized', async () => {
    expect(refusalOf(await contributionOf(loaded(stranger))).reason).toBe('PeerUnrecognized')
  })

  it('refuses a version string with a non-function parse as unrecognized', async () => {
    expect(refusalOf(await contributionOf(loaded({ VERSION: '5.0.0', parse: 'nope' }))).reason).toBe(
      'PeerUnrecognized',
    )
  })
})

describe('svelte plugin entry', () => {
  it('exports exactly one contribution', () => {
    expect(strykerFrameworks).toHaveLength(1)
  })

  it('exports the framework with the installed compiler version', async () => {
    const framework = frameworkOf(strykerFrameworks[0] as FrameworkContribution)
    const loadedPeer = await loadPeer(COMPILER_SPECIFIER)
    if (loadedPeer.kind !== 'Loaded') {
      throw new Error('the installed svelte compiler must load')
    }
    const installed = loadedPeer.module as { readonly VERSION: string }
    expect(framework.claim).toStrictEqual({
      formatId: 'svelte',
      extensions: ['.svelte'],
      language: 'svelte',
      ownerVersion: installed.VERSION,
      contractVersion: '1',
    })
  })
})
