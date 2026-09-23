import type { FrameworkContext, Program } from '@systemfsoftware/stryker-framework-interface'
import type { FrameworkContribution, FrameworkRefusal } from '@systemfsoftware/stryker-framework-interface'
import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }
import {
  frameworkContribution,
  frameworkOf,
  isResolutionError,
  SUPPORTED_VERSION_RANGE,
  versionFloorOf,
} from '../src/compiler-resolution.js'
import * as interopWalker from './__fixtures__/peer-oxc-walker-interop.mjs'
import * as fixtureWalker from './__fixtures__/peer-oxc-walker.mjs'
import * as belowPeer from './__fixtures__/peer-svelte-below.mjs'
import * as interopCompiler from './__fixtures__/peer-svelte-compiler-interop.mjs'
import * as floorPeer from './__fixtures__/peer-svelte-floor.mjs'
import * as interopShapeless from './__fixtures__/peer-svelte-interop-shapeless.mjs'
import * as shapelessPeer from './__fixtures__/peer-svelte-shapeless.mjs'
import * as strangerPeer from './__fixtures__/peer-svelte-stranger.mjs'
import * as walkerlessPeer from './__fixtures__/peer-svelte-walkerless.mjs'

const floorParts = manifest.peerDependencies.svelte.replace('>=', '').split('.')
const floorVersion = `${floorParts[0]}.${floorParts[1]}.0`
const belowVersion = `${floorParts[0]}.${Number(floorParts[1]) - 1}.0`

const contributionOf = (compiler: unknown, walker: unknown): FrameworkContribution => frameworkOf(compiler, walker)

const refusalOf = (contribution: FrameworkContribution): FrameworkRefusal => {
  if (contribution.kind !== 'FrameworkRefusal') {
    throw new Error('expected a refusal')
  }
  return contribution
}

const frameworkVersionOf = (contribution: FrameworkContribution): string => {
  if (contribution.kind !== 'Framework') {
    throw new Error('expected a framework')
  }
  return contribution.claim.ownerVersion
}

const emptyToolkit = (): FrameworkContext => ({
  parseScript: () => scriptProgram(),
  transformScript: (script) => script,
  printScript: () => '',
  instrumentationHeader: () => [],
})

const scriptProgram = (): Program => ({ type: 'Program', sourceType: 'module', body: [], hashbang: null })

const missingLoader = async (): Promise<unknown> => {
  throw Object.assign(new Error("Cannot find module 'svelte/compiler'"), { code: 'ERR_MODULE_NOT_FOUND' })
}

const typeErrorLoader = async (): Promise<unknown> => {
  throw new TypeError('not an object')
}

const walkerGoneLoader = async (): Promise<unknown> => {
  throw new Error('walker gone')
}

describe('svelte compiler resolution', () => {
  it('Declares_The_Same_Svelte_Range_As_The_Peer_Dependency', () => {
    expect(SUPPORTED_VERSION_RANGE).toBe(manifest.peerDependencies.svelte)
  })

  it('Decodes_The_Version_Floor_From_The_Supported_Range', () => {
    expect(versionFloorOf(SUPPORTED_VERSION_RANGE)).toStrictEqual({
      major: Number(floorParts[0]),
      minor: Number(floorParts[1]),
    })
  })

  it('Rejects_A_Range_Without_A_Version_Floor', () => {
    expect(() => versionFloorOf('latest')).toThrow('declares no minimum version')
  })

  it('Accepts_An_Interop_Wrapped_Compiler_And_Walker', () => {
    expect(frameworkVersionOf(contributionOf(interopCompiler, interopWalker))).toBe('5.0.0')
  })

  it('Refuses_A_Compiler_Below_The_Supported_Range', () => {
    expect(refusalOf(contributionOf(belowPeer, fixtureWalker))).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerVersionUnsupported',
      peer: 'svelte',
      detail: `svelte ${belowVersion} is not supported (expected ${SUPPORTED_VERSION_RANGE})`,
    })
  })

  it('Refuses_A_Compiler_With_An_Empty_Version', () => {
    expect(refusalOf(contributionOf({ VERSION: '', parse: Reflect.get(floorPeer, 'parse') }, fixtureWalker)).detail)
      .toBe(
        'the "svelte/compiler" module must export VERSION and parse',
      )
  })

  it('Refuses_A_Shapeless_Compiler_Module', () => {
    expect(refusalOf(contributionOf(shapelessPeer, fixtureWalker)).reason).toBe('PeerVersionUnsupported')
  })

  it('Refuses_An_Interop_Shapeless_Compiler_Module', () => {
    expect(refusalOf(contributionOf(interopShapeless, fixtureWalker)).reason).toBe('PeerVersionUnsupported')
  })

  it('Refuses_A_Compiler_That_Is_Not_A_Compiler', () => {
    expect(refusalOf(contributionOf(strangerPeer, fixtureWalker)).reason).toBe('PeerVersionUnsupported')
  })
  it('Refuses_A_Legacy_Compiler_That_Exports_No_Parse', () => {
    expect(refusalOf(contributionOf(walkerlessPeer, fixtureWalker)).reason).toBe('PeerVersionUnsupported')
  })

  it('Refuses_A_Compiler_Module_That_Is_Not_An_Object', () => {
    expect(refusalOf(contributionOf('svelte/compiler', fixtureWalker)).reason).toBe('PeerVersionUnsupported')
  })

  it('Throws_When_The_Legacy_Walker_Module_Is_Unshaped', () => {
    expect(() => contributionOf({ VERSION: floorVersion, parse: Reflect.get(floorPeer, 'parse') }, { shapeless: true }))
      .toThrow(
        'no template walker',
      )
  })
  it('Accepts_The_Oldest_Supported_Compiler', () => {
    expect(
      frameworkVersionOf(
        contributionOf({ VERSION: floorVersion, parse: Reflect.get(floorPeer, 'parse') }, fixtureWalker),
      ),
    ).toBe(
      floorVersion,
    )
  })
})

describe('resolution error codes', () => {
  it('Treats_Module_Not_Found_As_A_Missing_Peer', () => {
    expect(isResolutionError({ code: 'ERR_MODULE_NOT_FOUND' })).toBe(true)
    expect(isResolutionError({ code: 'MODULE_NOT_FOUND' })).toBe(true)
  })

  it('Leaves_Other_Failures_Alone', () => {
    expect(isResolutionError({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })).toBe(false)
    expect(isResolutionError({ code: 42 })).toBe(false)
    expect(isResolutionError(new Error('boom'))).toBe(false)
    expect(isResolutionError(undefined)).toBe(false)
  })
})

const floorLoader = async (): Promise<unknown> => floorPeer

const fixtureWalkerLoader = async (): Promise<unknown> => fixtureWalker

describe('framework contribution loading', () => {
  it('Builds_The_Framework_From_Loaded_Modules', async () => {
    expect(frameworkVersionOf(await frameworkContribution(floorLoader, fixtureWalkerLoader))).toBe(floorVersion)
  })

  it('Refuses_With_PeerMissing_When_The_Compiler_Does_Not_Resolve', async () => {
    expect(refusalOf(await frameworkContribution(missingLoader, fixtureWalkerLoader))).toStrictEqual({
      kind: 'FrameworkRefusal',
      name: 'svelte',
      reason: 'PeerMissing',
      peer: 'svelte',
      detail: 'the "svelte" peer is not installed',
    })
  })

  it('Propagates_A_Compiler_Import_Throw', async () => {
    await expect(frameworkContribution(typeErrorLoader, fixtureWalkerLoader)).rejects.toThrow('not an object')
  })

  it('Propagates_A_Walker_Import_Throw', async () => {
    await expect(frameworkContribution(floorLoader, walkerGoneLoader)).rejects.toThrow('walker gone')
  })

  it('Serves_A_Parsed_Component_Through_The_Loaded_Framework', async () => {
    const contribution = await frameworkContribution(floorLoader, fixtureWalkerLoader)
    if (contribution.kind !== 'Framework') {
      throw new Error('expected a framework')
    }
    const parsed = contribution.parse('<script>\n  export let n = 1\n</script>\n<p>{n}</p>\n', emptyToolkit())
    expect(parsed.kind).toBe('Parsed')
  })
})
