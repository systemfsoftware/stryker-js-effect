import type { Framework, FrameworkContribution, FrameworkRefusal } from '@systemfsoftware/stryker-framework-interface'
import { describe, it } from '@systemfsoftware/vitest'

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

const rejectionOf = <A>(promise: Promise<A>): Promise<unknown> =>
  promise.then(() => undefined, (error: unknown) => error)

const installedPeer = await loadPeer(COMPILER_SPECIFIER)
const missingPeer = await loadPeer(MISSING_SPECIFIER)
const bareValueRejection = await rejectionOf(loadPeer('../tests/__fixtures__/peer-rejecting-value.mjs'))
const codedRejection = await rejectionOf(
  contributionOf(() => loadPeer('../tests/__fixtures__/peer-rejecting-error.mjs')),
)
const missingRefusal = await contributionOf(() => loadPeer(MISSING_SPECIFIER))
const fiveContribution = await contributionOf(loaded(five))
const fourContribution = await contributionOf(loaded(four))
const sixContribution = await contributionOf(loaded(six))
const shapelessContribution = await contributionOf(loaded(shapeless))
const strangerContribution = await contributionOf(loaded(stranger))
const nonFunctionParseContribution = await contributionOf(loaded({ VERSION: '5.0.0', parse: 'nope' }))

describe('svelte peer loading', () => {
  it('loads the peer the package names through a dynamic import', function*({ expect }) {
    if (installedPeer.kind !== 'Loaded') {
      throw new Error('the installed svelte compiler must load')
    }
    yield* expect(typeof Reflect.get(installedPeer.module as object, 'VERSION')).toBe('string')
  })

  it('answers Missing for a specifier that does not resolve', function*({ expect }) {
    yield* expect(missingPeer).toStrictEqual({ kind: 'Missing' })
  })

  it('propagates an import failure that carries no error code', function*({ expect }) {
    yield* expect(bareValueRejection).toBe('the peer module rejected with a bare value')
  })

  it('propagates an import failure with an unrelated error code', function*({ expect }) {
    const message = codedRejection instanceof Error ? codedRejection.message : String(codedRejection)
    yield* expect(message).toContain('the peer module failed while evaluating')
  })

  it('reports an unresolved peer through the shared contribution decision', function*({ expect }) {
    yield* expect(refusalOf(missingRefusal)).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerMissing',
      peer: 'svelte',
      detail: 'the "svelte" peer is not installed',
    })
  })
})

describe('svelte peer decisions', () => {
  it('declares the same range the manifest peers on', function*({ expect }) {
    yield* expect({ supported: SUPPORTED_RANGE, manifest: manifest.peerDependencies.svelte }).toEqual({
      supported: '^5.0.0',
      manifest: '^5.0.0',
    })
  })

  it('serves a framework for the 5.x fixture compiler', function*({ expect }) {
    const framework = frameworkOf(fiveContribution)
    yield* expect({ name: framework.name, ownerVersion: framework.claim.ownerVersion }).toEqual({
      name: 'svelte',
      ownerVersion: '5.0.0',
    })
  })

  it('refuses the 4.x fixture compiler with the installed version and the supported range', function*({ expect }) {
    yield* expect(refusalOf(fourContribution)).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerVersionUnsupported',
      peer: 'svelte',
      detail: 'svelte 4.2.19 is not supported (expected ^5.0.0)',
    })
  })

  it('refuses the 6.x fixture compiler with the installed version and the supported range', function*({ expect }) {
    yield* expect(refusalOf(sixContribution)).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerVersionUnsupported',
      peer: 'svelte',
      detail: 'svelte 6.0.0-next.1 is not supported (expected ^5.0.0)',
    })
  })

  it('refuses a module that exports no compiler surface as unrecognized', function*({ expect }) {
    yield* expect(refusalOf(shapelessContribution)).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerUnrecognized',
      peer: 'svelte',
      detail: 'the "svelte/compiler" module must export a VERSION string and a parse function',
    })
  })

  it(
    'refuses a version that is not a string and a parse that is not a function as unrecognized',
    function*({ expect }) {
      yield* expect(refusalOf(strangerContribution).reason).toBe('PeerUnrecognized')
    },
  )

  it('refuses a version string with a non-function parse as unrecognized', function*({ expect }) {
    yield* expect(refusalOf(nonFunctionParseContribution).reason).toBe('PeerUnrecognized')
  })
})

describe('svelte plugin entry', () => {
  it('exports exactly one contribution', function*({ expect }) {
    yield* expect(strykerFrameworks.map((one) => one.kind)).toEqual(['Framework'])
  })

  it('exports the framework with the installed compiler version', function*({ expect }) {
    const framework = frameworkOf(strykerFrameworks[0] as FrameworkContribution)
    if (installedPeer.kind !== 'Loaded') {
      throw new Error('the installed svelte compiler must load')
    }
    const installed = installedPeer.module as { readonly VERSION: string }
    yield* expect(framework.claim).toStrictEqual({
      formatId: 'svelte',
      extensions: ['.svelte'],
      language: 'svelte',
      ownerVersion: installed.VERSION,
      contractVersion: '1',
    })
  })
})
