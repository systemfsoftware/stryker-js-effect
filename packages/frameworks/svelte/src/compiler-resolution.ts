import { FrameworkFailed, Module } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
import { SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

const MINIMUM_SVELTE_VERSION: Version = { major: 3, minor: 30 }
const SVELTE_5: Version = { major: 5, minor: 0 }
const SVELTE_PEER_RANGE = `>=${MINIMUM_SVELTE_VERSION.major}.${MINIMUM_SVELTE_VERSION.minor}`

const COMPILER_SPECIFIER = 'svelte/compiler'
const WALKER_SPECIFIER = 'oxc-walker'
const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?/

export type PeerLoader = (specifier: string) => Promise<unknown>

export interface SvelteWalkFn {
  (node: unknown, handlers: { readonly enter: (node: unknown) => void }): unknown
}

export interface SvelteScriptTag {
  readonly content: string
  readonly lang: unknown
}

export interface SvelteCompiler {
  readonly version: string
  readonly parse: (source: string, options: { readonly filename: string }) => unknown
  readonly preprocess: (
    source: string,
    handlers: { readonly script: (script: unknown) => { readonly code: string } },
  ) => Promise<{ readonly code: string }>
  readonly walk: SvelteWalkFn
}

interface Version {
  readonly major: number
  readonly minor: number
}

interface CompilerModule {
  readonly VERSION: string
  readonly parse: SvelteCompiler['parse']
  readonly preprocess: SvelteCompiler['preprocess']
}

const COMPILER_FIELDS: Readonly<Record<string, (value: unknown) => boolean>> = {
  VERSION: (value) => typeof value === 'string',
  parse: (value) => typeof value === 'function',
  preprocess: (value) => typeof value === 'function',
}

const WALK_FIELDS: Readonly<Record<string, (value: unknown) => boolean>> = {
  walk: (value) => typeof value === 'function',
}

const isCompilerModule = (value: unknown): value is CompilerModule =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (module) => hasFields(module, COMPILER_FIELDS)),
    Match.orElse(() => false),
  )

const isRecordWithWalk = (value: unknown): value is { readonly walk: SvelteWalkFn } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (module) => hasFields(module, WALK_FIELDS)),
    Match.orElse(() => false),
  )

const hasFields = (value: { readonly [key: PropertyKey]: unknown }, fields: typeof COMPILER_FIELDS): boolean =>
  Object.entries(fields).every(([field, accepts]) => accepts(value[field]))

const parseVersion = (version: string): Version | undefined => {
  const match = VERSION_PATTERN.exec(version)
  if (match === null) {
    return undefined
  }
  return versionFromMatch(match)
}

const versionFromMatch = (match: RegExpExecArray): Version | undefined => {
  const major = Number.parseInt(String(match[1]), 10)
  const minor = Number.parseInt(String(match[2]), 10)
  const invalid = Number.isNaN(major) || Number.isNaN(minor)
  return Match.value(invalid).pipe(
    Match.when(true, (): Version | undefined => undefined),
    Match.orElse((): Version | undefined => ({ major, minor })),
  )
}

const compareVersion = (left: Version, right: Version): number =>
  Match.value(left.major === right.major).pipe(
    Match.when(true, () => left.minor - right.minor),
    Match.orElse(() => left.major - right.major),
  )

const isAtLeast = (version: string, minimum: Version): boolean =>
  Match.value(parseVersion(version)).pipe(
    Match.when(Predicate.isNotNullish, (parsed) => compareVersion(parsed, minimum) >= 0),
    Match.orElse(() => false),
  )

const refusal = (reason: string, detail: string): FrameworkFailed => new FrameworkFailed({ reason, cause: detail })

const peerMissing = (peer: string): FrameworkFailed => refusal('PeerMissing', `the "${peer}" peer is not installed`)

const peerVersionUnsupported = (version: string): FrameworkFailed =>
  refusal('PeerVersionUnsupported', `svelte ${version} is not supported (expected ${SVELTE_PEER_RANGE})`)

const invalidContribution = (detail: string): FrameworkFailed => refusal('InvalidContribution', detail)

const loadedCompilerModule = (load: PeerLoader): Effect.Effect<unknown, FrameworkFailed> =>
  Effect.tryPromise({
    try: () => load(COMPILER_SPECIFIER),
    catch: () => peerMissing('svelte'),
  })

const decodedCompilerModule = (module: unknown): Effect.Effect<CompilerModule, FrameworkFailed> =>
  Match.value(module).pipe(
    Match.when(isCompilerModule, (compiler) => Effect.succeed(compiler)),
    Match.orElse(() =>
      Effect.fail(invalidContribution(`"${COMPILER_SPECIFIER}" must export VERSION, parse, and preprocess`))
    ),
  )

const assertSupportedVersion = (version: string): Effect.Effect<void, FrameworkFailed> =>
  Match.value(isAtLeast(version, MINIMUM_SVELTE_VERSION)).pipe(
    Match.when(true, () => Effect.void),
    Match.orElse(() => Effect.fail(peerVersionUnsupported(version))),
  )

const loadedWalker = (load: PeerLoader, specifier: string): Effect.Effect<SvelteWalkFn, FrameworkFailed> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => load(specifier),
      catch: () => peerMissing(specifier),
    }),
    (module) =>
      Match.value(module).pipe(
        Match.when(isRecordWithWalk, (withWalk) => Effect.succeed(withWalk.walk)),
        Match.orElse(() => Effect.fail(invalidContribution(`"${specifier}" must export walk`))),
      ),
  )

const resolveWalk = (load: PeerLoader, version: string): Effect.Effect<SvelteWalkFn, FrameworkFailed> =>
  Match.value(isAtLeast(version, SVELTE_5)).pipe(
    Match.when(true, () => loadedWalker(load, WALKER_SPECIFIER)),
    Match.orElse(() => loadedWalker(load, COMPILER_SPECIFIER)),
  )

export const resolveSvelteCompiler = (load: PeerLoader): Effect.Effect<SvelteCompiler, FrameworkFailed> =>
  Effect.gen(function*() {
    const compiler = yield* Effect.flatMap(loadedCompilerModule(load), decodedCompilerModule)
    yield* assertSupportedVersion(compiler.VERSION)
    const walk = yield* resolveWalk(load, compiler.VERSION)
    return {
      version: compiler.VERSION,
      parse: compiler.parse,
      preprocess: compiler.preprocess,
      walk,
    }
  })

const loadResolvedPeer = async (
  requireFromProject: ModuleRequire,
  pathService: Path.Path,
  specifier: string,
): Promise<unknown> => import(await resolvePeerUrl(requireFromProject, pathService, specifier))

const resolvePeerUrl = async (
  requireFromProject: ModuleRequire,
  pathService: Path.Path,
  specifier: string,
): Promise<string> => {
  const resolved = Result.try(() => requireFromProject.resolve(specifier))
  if (!Result.isSuccess(resolved)) {
    return import.meta.resolve(specifier)
  }
  return (await Effect.runPromise(pathService.toFileUrl(resolved.success))).href
}

export const peerLoader: Effect.Effect<PeerLoader, never, Module | Path.Path | SandboxDirectory> = Effect.gen(
  function*() {
    const moduleService = yield* Module
    const pathService = yield* Path.Path
    const sandboxDirectory = yield* SandboxDirectory
    const requireFromProject = moduleService.createRequire(pathService.join(sandboxDirectory, 'package.json'))
    return (specifier: string): Promise<unknown> => loadResolvedPeer(requireFromProject, pathService, specifier)
  },
)
