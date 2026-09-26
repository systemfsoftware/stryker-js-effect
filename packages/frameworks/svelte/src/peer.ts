import type {
  FrameworkContribution,
  FrameworkRefusal,
  FrameworkRefusalReason,
} from '@systemfsoftware/stryker-framework-interface'
import manifest from '../package.json' with { type: 'json' }

import type { CompilerModule } from './compiler.js'
import { compilerOf, isObject } from './compiler.js'
import { svelteFramework } from './framework.js'
export const COMPILER_SPECIFIER = 'svelte/compiler'

const PLUGIN_NAME = 'svelte'
const PLUGIN_PEER = 'svelte'

const NOT_FOUND_CODES: Record<string, true> = { ERR_MODULE_NOT_FOUND: true, MODULE_NOT_FOUND: true }

export const SUPPORTED_RANGE: string = manifest.peerDependencies.svelte

const majorOf = (version: string): number => Number.parseInt(version.replace(/^\D+/, ''), 10)

const SUPPORTED_MAJOR = majorOf(SUPPORTED_RANGE)

export type PeerLoad = { readonly kind: 'Loaded'; readonly module: unknown } | { readonly kind: 'Missing' }

export const loadPeer = async (specifier: string): Promise<PeerLoad> => import(specifier).then(loadedPeer, refusedPeer)

export const contributionOf = async (load: () => Promise<PeerLoad>): Promise<FrameworkContribution> =>
  decideContribution(await load())

const loadedPeer = (module: unknown): PeerLoad => ({ kind: 'Loaded', module })

const refusedPeer = (cause: unknown): Promise<PeerLoad> => missingPeer(cause)

const missingPeer = async (cause: unknown): Promise<PeerLoad> =>
  knownCode(codeOf(cause)) ? { kind: 'Missing' } : Promise.reject(cause)

const knownCode = (code: string | undefined): boolean => code !== undefined && isKnownCode(code)

const isKnownCode = (code: string): boolean => NOT_FOUND_CODES[code] === true

const codeOf = (cause: unknown): string | undefined => codedText(codedCause(cause))

const codedCause = (cause: unknown): Record<'code', unknown> | undefined => keyedCause(objectCause(cause))
const objectCause = (cause: unknown): Record<string, unknown> | undefined => isObject(cause) ? cause : undefined

const keyedCause = (cause: Record<string, unknown> | undefined): Record<'code', unknown> | undefined =>
  cause === undefined ? undefined : codedKey(cause)

const codedKey = (cause: Record<string, unknown>): Record<'code', unknown> | undefined =>
  'code' in cause ? cause : undefined

const codedText = (cause: Record<'code', unknown> | undefined): string | undefined => textOf(cause?.['code'])

const textOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const decideContribution = (loaded: PeerLoad): FrameworkContribution =>
  loaded.kind === 'Missing' ? missingRefusal() : peerContribution(loaded.module)

const missingRefusal = (): FrameworkRefusal => refusalOf('PeerMissing', `the "${PLUGIN_PEER}" peer is not installed`)

const peerContribution = (module: unknown): FrameworkContribution => unrecognizedOf(compilerOf(module))

const unrecognizedOf = (compiler: CompilerModule | undefined): FrameworkContribution =>
  compiler === undefined ? unrecognizedRefusal() : versionContribution(compiler)

const unrecognizedRefusal = (): FrameworkRefusal =>
  refusalOf('PeerUnrecognized', `the "${COMPILER_SPECIFIER}" module must export a VERSION string and a parse function`)

const versionContribution = (compiler: CompilerModule): FrameworkContribution =>
  versionMatches(compiler.VERSION) ? svelteFramework(compiler) : versionRefusal(compiler.VERSION)

const versionMatches = (version: string): boolean => majorOf(version) === SUPPORTED_MAJOR

const versionRefusal = (version: string): FrameworkRefusal =>
  refusalOf('PeerVersionUnsupported', `svelte ${version} is not supported (expected ${SUPPORTED_RANGE})`)

const refusalOf = (reason: FrameworkRefusalReason, detail: string): FrameworkRefusal => ({
  kind: 'FrameworkRefusal',
  name: PLUGIN_NAME,
  reason,
  peer: PLUGIN_PEER,
  detail,
})
