import type {
  Framework,
  FrameworkContribution,
  FrameworkRefusal,
  FrameworkRefusalReason,
} from '@systemfsoftware/stryker-framework-interface'

import { isFilled, isFunction, isRecord, isString } from './guards.js'
import type { SvelteCompilerModule, SvelteWalkFn } from './svelte-format.js'
import { svelteFramework } from './svelte-format.js'

const PLUGIN_NAME = 'svelte'
const PLUGIN_PEER = 'svelte'
const COMPILER_SPECIFIER = 'svelte/compiler'

export const SUPPORTED_VERSION_RANGE = '>=3.30'

const UNUSABLE_PEER = `the "${COMPILER_SPECIFIER}" module must export VERSION and parse`

const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?/

const RESOLUTION_CODES: Readonly<Record<string, true>> = { ERR_MODULE_NOT_FOUND: true, MODULE_NOT_FOUND: true }

const INTEROP_KEYS: readonly string[] = ['default', 'module.exports']

const SVELTE_FIVE: Version = { major: 5, minor: 0 }

interface Version {
  readonly major: number
  readonly minor: number
}

const hasFields = (value: Record<string, unknown>): boolean => hasVersion(value) && hasParse(value)

const hasVersion = (value: Record<string, unknown>): boolean => isFilled(value['VERSION'])

const hasParse = (value: Record<string, unknown>): boolean => isFunction(value['parse'])

const isCompilerShapeModule = (value: unknown): value is SvelteCompilerModule => isRecord(value) && hasFields(value)

const hasWalk = (value: Record<string, unknown>): boolean => isFunction(value['walk'])

const isWalkerModule = (value: unknown): value is { readonly walk: SvelteWalkFn } => isRecord(value) && hasWalk(value)
const isCodedError = (value: unknown): value is Record<string, unknown> => isRecord(value) && 'code' in value

const interopCandidates = (module: unknown): readonly unknown[] =>
  isRecord(module) ? [module, ...INTEROP_KEYS.map((key) => module[key])] : [module]

const unwrap = <Shape>(module: unknown, accepts: (value: unknown) => value is Shape): Shape | undefined =>
  interopCandidates(module).find(accepts)

const decodedCompiler = (module: unknown): SvelteCompilerModule | undefined => unwrap(module, isCompilerShapeModule)

const decodedWalk = (module: unknown): SvelteWalkFn | undefined => {
  const walker = unwrap(module, isWalkerModule)
  return walker === undefined ? undefined : walker.walk
}

const floorOfMatch = (match: RegExpExecArray): Version => ({
  major: Number.parseInt(String(match[1]), 10),
  minor: Number.parseInt(String(match[2]), 10),
})

export const versionFloorOf = (range: string): Version => {
  const match = VERSION_PATTERN.exec(range.replace('>=', ''))
  if (match === null) {
    throw new Error(`the supported range "${range}" declares no minimum version`)
  }
  return floorOfMatch(match)
}

const MINIMUM_SVELTE_VERSION = versionFloorOf(SUPPORTED_VERSION_RANGE)

const parseVersion = (version: string): Version | undefined => {
  const match = VERSION_PATTERN.exec(version)
  return match === null ? undefined : floorOfMatch(match)
}

const compareVersion = (left: Version, right: Version): number =>
  left.major === right.major ? left.minor - right.minor : left.major - right.major

const isAtLeast = (version: string, minimum: Version): boolean => {
  const parsed = parseVersion(version)
  return parsed !== undefined && compareVersion(parsed, minimum) >= 0
}

const refusalOf = (reason: FrameworkRefusalReason, detail: string): FrameworkRefusal => ({
  kind: 'FrameworkRefusal',
  name: PLUGIN_NAME,
  reason,
  peer: PLUGIN_PEER,
  detail,
})

const compilerWalkOf = (compilerModule: unknown): SvelteWalkFn | undefined => decodedWalk(compilerModule)

const modernWalkOf = (walkerModule: unknown): SvelteWalkFn | undefined => decodedWalk(walkerModule)

const legacyWalkOf = (compilerModule: unknown, walkerModule: unknown): SvelteWalkFn | undefined =>
  compilerWalkOf(compilerModule) ?? decodedWalk(walkerModule)

const walkerOf = (
  version: string,
  compilerModule: unknown,
  walkerModule: unknown,
): SvelteWalkFn | undefined =>
  isAtLeast(version, SVELTE_FIVE) ? modernWalkOf(walkerModule) : legacyWalkOf(compilerModule, walkerModule)

const frameworkWithWalker = (
  version: string,
  compiler: SvelteCompilerModule,
  compilerModule: unknown,
  walkerModule: unknown,
): Framework => {
  const walker = walkerOf(version, compilerModule, walkerModule)
  if (walker === undefined) {
    throw new Error(`the svelte ${version} compiler exports no template walker`)
  }
  return svelteFramework(version, compiler, walker)
}

const unsupportedVersion = (version: string): FrameworkContribution =>
  refusalOf('PeerVersionUnsupported', `svelte ${version} is not supported (expected ${SUPPORTED_VERSION_RANGE})`)

const servedVersion = (
  version: string,
  compiler: SvelteCompilerModule,
  compilerModule: unknown,
  walkerModule: unknown,
): FrameworkContribution =>
  isAtLeast(version, MINIMUM_SVELTE_VERSION)
    ? frameworkWithWalker(version, compiler, compilerModule, walkerModule)
    : unsupportedVersion(version)

export const frameworkOf = (compilerModule: unknown, walkerModule: unknown): FrameworkContribution => {
  const compiler = decodedCompiler(compilerModule)
  return compiler === undefined
    ? refusalOf('PeerVersionUnsupported', UNUSABLE_PEER)
    : servedVersion(compiler.VERSION, compiler, compilerModule, walkerModule)
}

export const isResolutionError = (cause: unknown): boolean => isCodedError(cause) && isKnownCode(cause['code'])

const isKnownCode = (code: unknown): boolean => isString(code) && RESOLUTION_CODES[code] === true

export const frameworkContribution = async (
  loadCompiler: () => Promise<unknown>,
  loadWalker: () => Promise<unknown>,
): Promise<FrameworkContribution> => {
  const compilerModule = await loadCompiler().catch((cause: unknown) =>
    isResolutionError(cause) ? missingCompiler() : Promise.reject(cause)
  )
  if (compilerModule === MISSING_COMPILER) {
    return refusalOf('PeerMissing', `the "${PLUGIN_PEER}" peer is not installed`)
  }
  return frameworkOf(compilerModule, await loadWalker())
}

const MISSING_COMPILER = Symbol('the svelte compiler did not resolve')

const missingCompiler = (): unknown => MISSING_COMPILER
