import { Schema as S } from 'effect'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

import type { Ignorer as IgnorerDescriptor } from '@systemfsoftware/stryker-ignorer-interface'
import { Framework } from '@systemfsoftware/stryker-js-language'
import type { FrameworkService, StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { Ignorer, Module } from '@systemfsoftware/stryker-js-language'
import type {
  AnyPluginContribution,
  ContributionOf,
  PluginContribution,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { declarePlugin, RunConfiguration, SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import type { PluginKind } from '@systemfsoftware/stryker-js-plugin-interface'
import { defaultOptions, importModule } from './Config.js'
import { StrykerError } from './stryker-error.schema.js'

import {
  FrameworkServiceSchema,
  IgnorerModuleSchema,
  PluginExtensionClaimShadowing,
  PluginLoadFailedError,
  PluginLoadOutcome,
  PluginModuleSchema,
  PluginNameShadowing,
  PluginNotFoundError,
  SchemaValidationContributionSchema,
} from './Plugins.schema.js'
import type {
  FrameworkClaim,
  PluginContributionIdentity,
  PluginDescriptorOutcome,
  PluginShadowing,
} from './Plugins.schema.js'

export interface PluginFrameworkEntry {
  readonly moduleName: string
  readonly contributionName: string
  readonly claim: FrameworkClaim
  readonly service: FrameworkService
}

export interface PluginLoaderEntryLike {
  readonly moduleName: string
  readonly outcome: PluginDescriptorOutcome
  readonly plugins: readonly PluginContribution<PluginKind>[] | undefined
  readonly schemaContribution: Record<string, unknown> | undefined
  readonly frameworks: readonly PluginFrameworkEntry[] | undefined
}

export interface PluginLoadPlan {
  readonly schemaContributions: readonly Record<string, unknown>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginContribution<PluginKind>[]>
  readonly pluginModulePaths: readonly string[]
  readonly outcomes: readonly PluginLoadOutcome[]
  readonly shadowings: readonly PluginShadowing[]
  readonly frameworks: readonly PluginFrameworkEntry[]
}

interface PluginClaimFold {
  readonly seen: HashMap.HashMap<string, string>
  readonly nameShadowings: readonly PluginNameShadowing[]
  readonly claimedExtensions: HashMap.HashMap<string, string>
  readonly extensionShadowings: readonly PluginExtensionClaimShadowing[]
}

const emptyClaimFold = (): PluginClaimFold => ({
  seen: HashMap.empty<string, string>(),
  nameShadowings: [],
  claimedExtensions: HashMap.empty<string, string>(),
  extensionShadowings: [],
})

const claimOf = (entry: PluginLoaderEntryLike, plugin: PluginContribution<PluginKind>): Option.Option<FrameworkClaim> =>
  Match.value(plugin.kind).pipe(
    Match.when('Framework', () =>
      Option.flatMap(
        Option.fromUndefinedOr(entry.frameworks),
        (frameworks) =>
          Option.map(
            Option.fromUndefinedOr(frameworks.find((framework) => framework.contributionName === plugin.name)),
            (framework) => framework.claim,
          ),
      )),
    Match.orElse(() => Option.none()),
  )

const foldExtensionClaims = (
  fold: PluginClaimFold,
  moduleName: string,
  kind: PluginKind,
  claim: FrameworkClaim,
): PluginClaimFold =>
  claim.extensions.reduce<PluginClaimFold>(
    (inner, extension) =>
      Option.match(HashMap.get(inner.claimedExtensions, extension), {
        onNone: () => ({
          ...inner,
          claimedExtensions: HashMap.set(inner.claimedExtensions, extension, moduleName),
        }),
        onSome: (winnerModule) => ({
          ...inner,
          extensionShadowings: [
            ...inner.extensionShadowings,
            new PluginExtensionClaimShadowing({
              kind,
              formatId: claim.formatId,
              extension,
              winnerModule,
              loserModule: moduleName,
            }),
          ],
        }),
      }),
    fold,
  )

const foldEntry = (fold: PluginClaimFold, entry: PluginLoaderEntryLike): PluginClaimFold =>
  Option.match(Option.fromUndefinedOr(entry.plugins), {
    onNone: () => fold,
    onSome: (plugins) =>
      plugins.reduce<PluginClaimFold>(
        (inner, plugin) => {
          const key = `${plugin.kind}:${plugin.name}`
          const firstModule = HashMap.get(inner.seen, key)
          const named: PluginClaimFold = {
            ...inner,
            seen: Option.match(firstModule, {
              onNone: () => HashMap.set(inner.seen, key, entry.moduleName),
              onSome: () => inner.seen,
            }),
            nameShadowings: Option.match(firstModule, {
              onNone: () => inner.nameShadowings,
              onSome: (winnerModule) => [
                ...inner.nameShadowings,
                new PluginNameShadowing({
                  kind: plugin.kind,
                  name: plugin.name,
                  winnerModule,
                  loserModule: entry.moduleName,
                }),
              ],
            }),
          }
          return Option.match(claimOf(entry, plugin), {
            onNone: () => named,
            onSome: (claim) => foldExtensionClaims(named, entry.moduleName, plugin.kind, claim),
          })
        },
        fold,
      ),
  })

const contributionIdentitiesOf = (entry: PluginLoaderEntryLike): readonly PluginContributionIdentity[] =>
  Option.getOrElse(
    Option.map(
      Option.fromUndefinedOr(entry.plugins),
      (plugins) => plugins.map((plugin) => ({ kind: plugin.kind, name: plugin.name })),
    ),
    (): readonly PluginContributionIdentity[] => [],
  )

const frameworksOf = (entry: PluginLoaderEntryLike): readonly PluginFrameworkEntry[] =>
  Option.getOrElse(Option.fromUndefinedOr(entry.frameworks), (): readonly PluginFrameworkEntry[] => [])

export const buildPluginLoadPlan = (entries: readonly PluginLoaderEntryLike[]): PluginLoadPlan => {
  const fold = entries.reduce<PluginClaimFold>(foldEntry, emptyClaimFold())

  const pluginsByKind = entries.reduce<HashMap.HashMap<PluginKind, readonly PluginContribution<PluginKind>[]>>(
    (map, entry) =>
      Option.match(Option.fromUndefinedOr(entry.plugins), {
        onNone: () => map,
        onSome: (plugins) =>
          plugins.reduce(
            (inner, plugin) =>
              Option.match(HashMap.get(inner, plugin.kind), {
                onNone: () => HashMap.set(inner, plugin.kind, [plugin]),
                onSome: (existing) => HashMap.set(inner, plugin.kind, [...existing, plugin]),
              }),
            map,
          ),
      }),
    HashMap.empty<PluginKind, readonly PluginContribution<PluginKind>[]>(),
  )

  const pluginModulePaths = entries.flatMap((entry) =>
    Option.match(Option.fromUndefinedOr(entry.plugins), {
      onNone: () => [],
      onSome: () => [entry.moduleName],
    })
  )

  const schemaContributions = entries.flatMap((entry) =>
    Option.match(Option.fromUndefinedOr(entry.schemaContribution), {
      onNone: () => [],
      onSome: (value) => [value],
    })
  )

  const outcomes = entries.map((entry) =>
    new PluginLoadOutcome({
      moduleName: entry.moduleName,
      outcome: entry.outcome,
      contributions: contributionIdentitiesOf(entry),
    })
  )

  return {
    schemaContributions,
    pluginsByKind,
    pluginModulePaths,
    outcomes,
    shadowings: [...fold.nameShadowings, ...fold.extensionShadowings],
    frameworks: entries.flatMap(frameworksOf),
  }
}

interface ErrnoException extends Error {
  code?: string
}

const isError = (error: unknown): error is Error => error instanceof Error

const hasErrorCode = (error: unknown): error is Record<'code', unknown> => Predicate.hasProperty(error, 'code')

const hasErrorMessage = (error: unknown): error is Record<'message', unknown> => Predicate.hasProperty(error, 'message')

const errorCodeOf = (error: unknown): unknown =>
  Match.value(error).pipe(
    Match.when(hasErrorCode, (carrier: Record<'code', unknown>) => carrier.code),
    Match.orElse(() => undefined),
  )

const errorMessageOf = (error: unknown): unknown =>
  Match.value(error).pipe(
    Match.when(hasErrorMessage, (carrier: Record<'message', unknown>) => carrier.message),
    Match.orElse(() => undefined),
  )

const isText = (value: unknown): value is string => typeof value === 'string'

const messageNamesDescriptor = (message: unknown, descriptor: string): boolean =>
  Match.value(message).pipe(
    Match.when(isText, (text: string) => text.includes(descriptor)),
    Match.orElse(() => false),
  )

const byDeterministicShadowingOrder = (left: string, right: string): number =>
  Match.value(left < right).pipe(
    Match.when(true, () => -1),
    Match.orElse(() => Match.value(left > right).pipe(Match.when(true, () => 1), Match.orElse(() => 0))),
  )

const invalidContributionError = (descriptor: string, detail: string): PluginLoadFailedError =>
  new PluginLoadFailedError({ descriptor, reason: { _tag: 'InvalidContribution', detail } })

const importFailedError = (descriptor: string, cause: unknown): PluginLoadFailedError =>
  new PluginLoadFailedError({ descriptor, reason: { _tag: 'ImportFailed', cause } })

function isErrnoException(error: unknown): error is ErrnoException {
  return Match.value(isError(error)).pipe(
    Match.when(true, () => typeof errorCodeOf(error) === 'string'),
    Match.orElse(() => false),
  )
}

const IGNORED_PACKAGES = [
  '.bin',
  '.cache',
  '.pnp',
  'stryker',
  'stryker-api',
  'stryker-parent',
]

interface PluginModule {
  strykerPlugins: readonly PluginContribution<PluginKind>[]
}

interface IgnorerModule {
  strykerIgnorers: readonly IgnorerDescriptor[]
}

interface SchemaValidationContribution {
  strykerValidationSchema: Record<string, unknown>
}

export interface LoadedPlugins {
  readonly schemaContributions: readonly Record<string, unknown>[]
  readonly pluginsByKind: HashMap.HashMap<PluginKind, readonly PluginContribution<PluginKind>[]>
  readonly pluginModulePaths: readonly string[]
  readonly outcomes: readonly PluginLoadOutcome[]
  readonly shadowings: readonly PluginShadowing[]
  readonly frameworks: readonly PluginFrameworkEntry[]
}

const ABSENT_MODULE_ERROR_CODES: readonly string[] = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']

export function isAbsentPluginError(error: unknown, descriptor: string): boolean {
  return Match.value(ABSENT_MODULE_ERROR_CODES.includes(String(errorCodeOf(error)))).pipe(
    Match.when(true, () => messageNamesDescriptor(errorMessageOf(error), descriptor)),
    Match.orElse(() => false),
  )
}

function isEnoentError(error: unknown): boolean {
  return Match.value(isErrnoException(error)).pipe(
    Match.when(true, () => errorCodeOf(error) === 'ENOENT'),
    Match.orElse(() => false),
  )
}

type PluginExpressionClass = 'Glob' | 'FilePath' | 'Module'

const isPluginGlobExpression = (pluginExpression: string): boolean => pluginExpression.includes('*')

const isPluginPathExpression = (pluginExpression: string, pathService: Path.Path): boolean =>
  Match.value(pathService.isAbsolute(pluginExpression)).pipe(
    Match.when(true, () => true),
    Match.orElse(() => pluginExpression.startsWith('.')),
  )

const classifyPluginExpression = (
  pluginExpression: string,
  pathService: Path.Path,
): PluginExpressionClass =>
  Match.value(isPluginGlobExpression(pluginExpression)).pipe(
    Match.when(true, (): PluginExpressionClass => 'Glob'),
    Match.orElse(() => classifyPluginLocationExpression(pluginExpression, pathService)),
  )

const classifyPluginLocationExpression = (
  pluginExpression: string,
  pathService: Path.Path,
): PluginExpressionClass =>
  Match.value(isPluginPathExpression(pluginExpression, pathService)).pipe(
    Match.when(true, (): PluginExpressionClass => 'FilePath'),
    Match.orElse((): PluginExpressionClass => 'Module'),
  )

const resolvePluginFileUrl = (
  pluginExpression: string,
  pathService: Path.Path,
): Effect.Effect<string[], PluginLoadFailedError> =>
  pathService.toFileUrl(pathService.resolve(pluginExpression)).pipe(
    Effect.mapError(() =>
      invalidContributionError(
        pluginExpression,
        'The plugin descriptor could not be resolved to a file URL.',
      )
    ),
    Effect.map((url) => [url.href]),
  )

const resolvePluginExpression = (
  pluginExpression: string,
  pathService: Path.Path,
): Effect.Effect<string[], PluginLoadFailedError, FileSystem.FileSystem | Path.Path> =>
  Match.value(classifyPluginExpression(pluginExpression, pathService)).pipe(
    Match.when('Glob', () => globPluginModules(pluginExpression)),
    Match.when('FilePath', () => resolvePluginFileUrl(pluginExpression, pathService)),
    Match.when('Module', () => Effect.succeed([pluginExpression])),
    Match.exhaustive,
  )

function resolvePluginModules(
  pluginDescriptors: readonly string[],
): Effect.Effect<string[], PluginLoadFailedError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function*() {
    const pathService = yield* Path.Path
    const results: string[][] = yield* Effect.forEach(
      pluginDescriptors,
      (pluginExpression: string) => resolvePluginExpression(pluginExpression, pathService),
      { concurrency: 'unbounded' },
    )
    return results.filter(Predicate.isNotNullish).flat().sort(byDeterministicShadowingOrder)
  })
}

const pluginNamePattern = (pkg: string): RegExp => new RegExp(`^${pkg.replace('*', '.*')}`)

const isSelectablePluginName = (pluginName: string, pattern: RegExp): boolean =>
  Match.value(IGNORED_PACKAGES.includes(pluginName)).pipe(
    Match.when(true, () => false),
    Match.orElse(() => pattern.test(pluginName)),
  )

const qualifyPluginName = (org: string, pluginName: string): string =>
  Match.value(org.length > 0).pipe(
    Match.when(true, () => `${org}/${pluginName}`),
    Match.orElse(() => pluginName),
  )

const selectPluginNames = (org: string, pkg: string, pluginNames: readonly string[]): string[] => {
  const pattern = pluginNamePattern(pkg)
  return pluginNames
    .filter((pluginName: string) => isSelectablePluginName(pluginName, pattern))
    .map((pluginName: string) => qualifyPluginName(org, pluginName))
}

const warnExpressionNotListed = (
  pluginExpression: string,
  defaults: { readonly plugins: readonly string[] },
): Effect.Effect<void> =>
  Match.value(defaults.plugins.includes(pluginExpression)).pipe(
    Match.when(true, () => Effect.void),
    Match.orElse(() => Effect.logWarning(`Expression "${pluginExpression}" not resulted in plugins to load.`)),
  )

const warnUnmatchedExpression = (
  pluginExpression: string,
  plugins: readonly string[],
  defaults: { readonly plugins: readonly string[] },
): Effect.Effect<void> =>
  Match.value(plugins.length > 0).pipe(
    Match.when(true, () => Effect.void),
    Match.orElse(() => warnExpressionNotListed(pluginExpression, defaults)),
  )

function globPluginModules(
  pluginExpression: string,
): Effect.Effect<string[], PluginLoadFailedError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function*() {
    const { org, pkg } = parsePluginExpression(pluginExpression)
    const pluginNames = yield* readOrgDirectory(org)
    const plugins = selectPluginNames(org, pkg, pluginNames)
    const defaults = yield* defaultOptions
    yield* warnUnmatchedExpression(pluginExpression, plugins, defaults)
    yield* Effect.forEach(
      plugins,
      (plugin: string) => Effect.logDebug(`Loading plugin "${plugin}" (matched with expression ${pluginExpression})`),
    )
    return plugins
  })
}

const emptyOrgEntries: readonly string[] = []

const installRootFor = (pathService: Path.Path, directory: string): string =>
  Match.value(pathService.basename(directory)).pipe(
    Match.when('node_modules', () => directory),
    Match.orElse(() => pathService.join(directory, 'node_modules')),
  )

const readOrgEntries = (
  fs: FileSystem.FileSystem,
  orgDirectory: string,
): Effect.Effect<readonly string[], PluginLoadFailedError> =>
  fs.readDirectory(orgDirectory).pipe(
    Effect.catchTag('PlatformError', (error) =>
      Match.value(error.reason).pipe(
        Match.tag('NotFound', () => Effect.succeed(emptyOrgEntries)),
        Match.orElse(() => Effect.fail(importFailedError(orgDirectory, error))),
      )),
    Effect.catch((error: unknown) =>
      Match.value(isEnoentError(error)).pipe(
        Match.when(true, () => Effect.succeed(emptyOrgEntries)),
        Match.orElse(() => Effect.fail(importFailedError(orgDirectory, error))),
      )
    ),
  )

const logFoundOrgPackages = (
  org: string,
  orgDirectory: string,
  entries: readonly string[],
): Effect.Effect<void> =>
  Match.value(entries.length > 0).pipe(
    Match.when(true, () => Effect.logDebug(`Found ${entries.length} ${org} packages in ${orgDirectory}`)),
    Match.orElse(() => Effect.void),
  )

const readOrgPackagesUpward = (
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  org: string,
  directory: string,
  names: HashSet.HashSet<string>,
): Effect.Effect<string[], PluginLoadFailedError> =>
  Effect.gen(function*() {
    const orgDirectory = pathService.resolve(installRootFor(pathService, directory), org)
    const entries = yield* readOrgEntries(fs, orgDirectory)
    yield* logFoundOrgPackages(org, orgDirectory, entries)
    const nextNames = entries.reduce((acc, entry) => HashSet.add(acc, entry), names)
    const parent = pathService.dirname(directory)
    return yield* Match.value(parent === directory).pipe(
      Match.when(true, () => Effect.succeed(Array.from(nextNames))),
      Match.orElse(() => readOrgPackagesUpward(fs, pathService, org, parent, nextNames)),
    )
  })

function readOrgDirectory(
  org: string,
): Effect.Effect<string[], PluginLoadFailedError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const base = yield* pathService.fromFileUrl(new URL('.', import.meta.url)).pipe(Effect.orDie)
    return yield* readOrgPackagesUpward(fs, pathService, org, pathService.dirname(base), HashSet.empty())
  })
}

interface PluginContributions {
  readonly plugins: readonly PluginContribution<PluginKind>[] | undefined
  readonly schemaContribution: Record<string, unknown> | undefined
}

const isStrykerError = (error: unknown): error is StrykerError => error instanceof StrykerError

const pluginFailureCause = (error: unknown): unknown =>
  Match.value(error).pipe(
    Match.when(isStrykerError, (strykerError: StrykerError) => strykerError.cause),
    Match.orElse(() => error),
  )

const warnAbsentPlugin = (descriptor: string): Effect.Effect<void> =>
  Effect.logWarning(`Cannot find plugin "${descriptor}".\n  Did you forget to install it ?`).pipe(Effect.asVoid)

const failPluginImport = (descriptor: string, error: unknown): Effect.Effect<never, PluginLoadFailedError> =>
  Effect.logWarning(`Error during loading "${descriptor}" plugin`).pipe(
    Effect.andThen(() => Effect.fail(importFailedError(descriptor, pluginFailureCause(error)))),
  )

const failPluginContribution = (
  descriptor: string,
  cause: S.SchemaError,
): Effect.Effect<never, PluginLoadFailedError> =>
  Effect.logWarning(`Invalid contribution in "${descriptor}" plugin`).pipe(
    Effect.andThen(() => Effect.fail(invalidContributionError(descriptor, cause.message))),
  )

const ignorerContribution = (ignorer: IgnorerDescriptor): PluginContribution<'Ignore'> =>
  declarePlugin(
    'Ignore',
    ignorer.name,
    Layer.succeed(Ignorer, {
      shouldIgnore: (node, ancestors) => Option.fromUndefinedOr(ignorer.shouldIgnore(node, ancestors)),
    }),
  )

const modulePluginContributions = (module: unknown): readonly PluginContribution<PluginKind>[] | undefined =>
  Match.value(module).pipe(
    Match.when(isPluginModule, (pluginModule: PluginModule) => pluginModule.strykerPlugins),
    Match.orElse((): undefined => undefined),
  )

const moduleIgnorers = (
  module: unknown,
): Result.Result<readonly PluginContribution<'Ignore'>[] | undefined, S.SchemaError> =>
  Match.value(Predicate.hasProperty(module, 'strykerIgnorers')).pipe(
    Match.when(true, () =>
      S.decodeUnknownResult(IgnorerModuleSchema)(module).pipe(
        Result.map((ignorerModule: IgnorerModule) => ignorerModule.strykerIgnorers.map(ignorerContribution)),
      )),
    Match.orElse(() => Result.succeed(undefined)),
  )

const moduleSchemaContribution = (module: unknown): Record<string, unknown> | undefined =>
  Match.value(module).pipe(
    Match.when(
      hasValidationSchemaContribution,
      (contribution: SchemaValidationContribution) => contribution.strykerValidationSchema,
    ),
    Match.orElse((): undefined => undefined),
  )

const mergeContributions = (
  native: readonly PluginContribution<PluginKind>[] | undefined,
  ignorers: readonly PluginContribution<'Ignore'>[] | undefined,
): readonly PluginContribution<PluginKind>[] | undefined =>
  Option.match(Option.fromUndefinedOr(native), {
    onNone: () => ignorers,
    onSome: (plugins) =>
      Option.match(Option.fromUndefinedOr(ignorers), {
        onNone: () => plugins,
        onSome: (ignoreContributions) => [...plugins, ...ignoreContributions],
      }),
  })

const pluginContributionsOf = (
  module: unknown,
): Result.Result<PluginContributions, S.SchemaError> =>
  moduleIgnorers(module).pipe(
    Result.map((ignorers) => ({
      plugins: mergeContributions(modulePluginContributions(module), ignorers),
      schemaContribution: moduleSchemaContribution(module),
    })),
  )

const hasContribution = (contributions: PluginContributions): boolean =>
  Match.value(contributions.plugins !== undefined).pipe(
    Match.when(true, () => true),
    Match.orElse(() => contributions.schemaContribution !== undefined),
  )

const warnUndescribedPluginModule = (descriptor: string): Effect.Effect<undefined> =>
  Effect.logWarning(
    `Module "${descriptor}" did not contribute a StrykerJS plugin. It didn't export a "strykerPlugins", "strykerIgnorers", or "strykerValidationSchema".`,
  ).pipe(Effect.as(undefined))

const describeLoadedPlugin = (
  descriptor: string,
  module: unknown,
): Effect.Effect<PluginContributions | undefined, PluginLoadFailedError> =>
  Result.match(pluginContributionsOf(module), {
    onFailure: (cause) => failPluginContribution(descriptor, cause),
    onSuccess: (contributions) =>
      Match.value(hasContribution(contributions)).pipe(
        Match.when(true, () => Effect.succeed<PluginContributions | undefined>(contributions)),
        Match.orElse(() => warnUndescribedPluginModule(descriptor)),
      ),
  })

type FrameworkEnvironment = Layer.Layer<RunConfiguration | SandboxDirectory>

const EMPTY_FRAMEWORK_CONTRIBUTIONS: readonly PluginContribution<'Framework'>[] = []

const frameworkContributionsOf = (
  plugins: readonly PluginContribution<PluginKind>[] | undefined,
): readonly PluginContribution<'Framework'>[] =>
  Option.match(Option.fromUndefinedOr(plugins), {
    onNone: () => EMPTY_FRAMEWORK_CONTRIBUTIONS,
    onSome: (present) =>
      present.filter((plugin): plugin is PluginContribution<'Framework'> => plugin.kind === 'Framework'),
  })

const frameworkEnvironment = (options: StrykerOptions, basePath: string): FrameworkEnvironment =>
  Layer.mergeAll(Layer.succeed(RunConfiguration, options), Layer.succeed(SandboxDirectory, basePath))

const SUPPORTED_FRAMEWORK_CONTRACT_MAJOR = 1
const SUPPORTED_FRAMEWORK_CONTRACT_RANGE = '1.x'

const isSupportedFrameworkContractVersion = (version: string): boolean =>
  Option.match(Option.fromNullishOr(version.split('.')[0]), {
    onNone: () => false,
    onSome: (major) =>
      Match.value(/^\d+$/.test(major)).pipe(
        Match.when(true, () => Number(major) === SUPPORTED_FRAMEWORK_CONTRACT_MAJOR),
        Match.orElse(() => false),
      ),
  })

const resolveModuleFrameworks = (
  moduleName: string,
  plugins: readonly PluginContribution<PluginKind>[] | undefined,
  environment: FrameworkEnvironment,
): Effect.Effect<
  readonly PluginFrameworkEntry[],
  PluginLoadFailedError,
  FileSystem.FileSystem | Module | Path.Path
> =>
  Effect.scoped(
    Effect.forEach(
      frameworkContributionsOf(plugins),
      (contribution) =>
        Effect.gen(function*() {
          const context = yield* Layer.build(contribution.layer).pipe(
            Effect.provide(environment),
            Effect.catchCause((cause) =>
              Effect.fail(
                invalidContributionError(
                  moduleName,
                  `Framework contribution "${contribution.name}" failed to build: ${Cause.pretty(cause)}`,
                ),
              )
            ),
          )
          const service = Context.get(context, Framework)
          const decoded = S.decodeUnknownResult(FrameworkServiceSchema)(service)
          return yield* Result.match(decoded, {
            onFailure: (cause) =>
              Effect.fail(
                invalidContributionError(
                  moduleName,
                  `Framework contribution "${contribution.name}" is malformed: ${cause.message}`,
                ),
              ),
            onSuccess: (valid) =>
              Match.value(isSupportedFrameworkContractVersion(valid.claim.contractVersion)).pipe(
                Match.when(true, () =>
                  Effect.succeed<PluginFrameworkEntry>({
                    moduleName,
                    contributionName: contribution.name,
                    claim: valid.claim,
                    service,
                  })),
                Match.orElse(() =>
                  Effect.fail(
                    invalidContributionError(
                      moduleName,
                      `Framework contribution "${contribution.name}" declares contractVersion "${valid.claim.contractVersion}"; the engine supports ${SUPPORTED_FRAMEWORK_CONTRACT_RANGE}`,
                    ),
                  )
                ),
              ),
          })
        }),
      { concurrency: 'unbounded' },
    ),
  )

type PluginLoadStep =
  | {
    readonly outcome: 'loaded'
    readonly contributions: PluginContributions
    readonly frameworks: readonly PluginFrameworkEntry[]
  }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'undescribed' }

function loadPlugin(
  descriptor: string,
  basePath: string,
  environment: FrameworkEnvironment,
): Effect.Effect<PluginLoadStep, PluginLoadFailedError, FileSystem.FileSystem | Module | Path.Path> {
  return Effect.gen(function*() {
    yield* Effect.logDebug(`Loading plugin ${descriptor}`)
    const imported = yield* importModule(descriptor, basePath).pipe(Effect.result)
    if (Result.isFailure(imported)) {
      return yield* absentOrImportFailureFor(descriptor, imported.failure)
    }
    return yield* Option.match(Option.fromUndefinedOr(imported.success), {
      onNone: () => Effect.succeed({ outcome: 'absent' as const }),
      onSome: (module) => loadedStepFor(descriptor, module, environment),
    })
  })
}

const absentOrImportFailureFor = (
  descriptor: string,
  error: StrykerError,
): Effect.Effect<PluginLoadStep, PluginLoadFailedError, FileSystem.FileSystem | Module | Path.Path> =>
  Effect.gen(function*() {
    if (isAbsentPluginError(pluginFailureCause(error), descriptor)) {
      yield* warnAbsentPlugin(descriptor)
      return { outcome: 'absent' as const }
    }
    return yield* failPluginImport(descriptor, error)
  })

const loadedStepFor = (
  descriptor: string,
  module: unknown,
  environment: FrameworkEnvironment,
): Effect.Effect<PluginLoadStep, PluginLoadFailedError, FileSystem.FileSystem | Module | Path.Path> =>
  Effect.gen(function*() {
    const contributions = yield* describeLoadedPlugin(descriptor, module)
    if (contributions === undefined) {
      return { outcome: 'undescribed' as const }
    }
    const frameworks = yield* resolveModuleFrameworks(descriptor, contributions.plugins, environment)
    return { outcome: 'loaded' as const, contributions, frameworks }
  })

interface PluginLoaderAttempt {
  readonly moduleName: string
  readonly result: Result.Result<PluginLoadStep, PluginLoadFailedError>
}

const entryOfAttempt = (attempt: PluginLoaderAttempt): PluginLoaderEntryLike =>
  Result.match(attempt.result, {
    onFailure: () => ({
      moduleName: attempt.moduleName,
      outcome: 'failed' as const,
      plugins: undefined,
      schemaContribution: undefined,
      frameworks: undefined,
    }),
    onSuccess: (step) =>
      Match.value(step).pipe(
        Match.when({ outcome: 'loaded' }, (loaded) => ({
          moduleName: attempt.moduleName,
          outcome: 'loaded' as const,
          plugins: loaded.contributions.plugins,
          schemaContribution: loaded.contributions.schemaContribution,
          frameworks: loaded.frameworks,
        })),
        Match.orElse((other) => ({
          moduleName: attempt.moduleName,
          outcome: other.outcome,
          plugins: undefined,
          schemaContribution: undefined,
          frameworks: undefined,
        })),
      ),
  })

const firstFailure = (attempts: readonly PluginLoaderAttempt[]): Option.Option<PluginLoadFailedError> =>
  Option.flatMap(
    Option.fromUndefinedOr(attempts.find((attempt) => Result.isFailure(attempt.result))),
    (failed) =>
      Result.match(failed.result, {
        onFailure: (error) => Option.some(error),
        onSuccess: () => Option.none(),
      }),
  )

const logShadowing = (shadowing: PluginShadowing): Effect.Effect<void> =>
  Match.value(shadowing).pipe(
    Match.tag('PluginNameShadowing', (name) =>
      Effect.logWarning(
        `Plugin "${name.name}" of kind "${name.kind}" from "${name.loserModule}" is shadowed by "${name.winnerModule}".`,
      )),
    Match.tag('PluginExtensionClaimShadowing', (extension) =>
      Effect.logWarning(
        `Extension "${extension.extension}" claimed by format "${extension.formatId}" in "${extension.loserModule}" is shadowed by "${extension.winnerModule}".`,
      )),
    Match.exhaustive,
  )

export function loadPlugins(
  pluginDescriptors: readonly string[],
  basePath: string,
): Effect.Effect<LoadedPlugins, PluginLoadFailedError, FileSystem.FileSystem | Module | Path.Path> {
  return Effect.gen(function*() {
    yield* FileSystem.FileSystem
    yield* Path.Path
    yield* Module
    const defaults = yield* defaultOptions
    const environment = frameworkEnvironment(defaults, basePath)
    const pluginModules = yield* resolvePluginModules(pluginDescriptors)
    const attempts = yield* Effect.forEach(
      pluginModules,
      (moduleName: string): Effect.Effect<PluginLoaderAttempt, never, FileSystem.FileSystem | Module | Path.Path> =>
        loadPlugin(moduleName, basePath, environment).pipe(
          Effect.result,
          Effect.map((result) => ({ moduleName, result })),
        ),
      { concurrency: 'unbounded' },
    )
    const plan = buildPluginLoadPlan(attempts.map(entryOfAttempt))
    for (const shadowing of plan.shadowings) {
      yield* logShadowing(shadowing)
    }
    const failure = firstFailure(attempts)
    return yield* Option.match(failure, {
      onNone: () =>
        Effect.succeed<LoadedPlugins>({
          schemaContributions: plan.schemaContributions,
          pluginsByKind: plan.pluginsByKind,
          pluginModulePaths: plan.pluginModulePaths,
          outcomes: plan.outcomes,
          shadowings: plan.shadowings,
          frameworks: plan.frameworks,
        }),
      onSome: (error) => Effect.fail(error),
    })
  })
}

const partsIncludeScope = (parts: readonly string[]): boolean =>
  Match.value(parts.length > 1).pipe(
    Match.when(true, () => parts[0]?.startsWith('@') === true),
    Match.orElse(() => false),
  )

function parsePluginExpression(pluginExpression: string): { org: string; pkg: string } {
  const parts = pluginExpression.split('/')
  return Match.value(partsIncludeScope(parts)).pipe(
    Match.when(
      true,
      (): { org: string; pkg: string } => ({
        org: parts.slice(0, 2).join('/').split('*')[0] ?? '',
        pkg: parts.slice(2).join('/'),
      }),
    ),
    Match.orElse((): { org: string; pkg: string } => ({
      org: '',
      pkg: pluginExpression,
    })),
  )
}

function isPluginModule(module: unknown): module is PluginModule {
  return S.is(PluginModuleSchema)(module)
}

function hasValidationSchemaContribution(module: unknown): module is SchemaValidationContribution {
  return S.is(SchemaValidationContributionSchema)(module)
}

const findContribution = <K extends PluginKind>(
  contributions: readonly AnyPluginContribution[],
  kind: K,
  name: string,
): Effect.Effect<ContributionOf<K>, PluginNotFoundError> =>
  Option.match(
    Option.fromUndefinedOr(
      contributions.find(
        (contribution): contribution is ContributionOf<K> =>
          contribution.kind === kind && contribution.name.toLowerCase() === name.toLowerCase(),
      ),
    ),
    {
      onNone: () =>
        Effect.fail(
          new PluginNotFoundError({
            descriptor: `${kind}:${name} (available: ${contributions.map((c) => c.name).join(', ')})`,
          }),
        ),
      onSome: (found) => Effect.succeed(found),
    },
  )

function findPlugin<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginContribution[]>,
  kind: K,
  name: string,
): Effect.Effect<ContributionOf<K>, PluginNotFoundError> {
  return Option.match(HashMap.get(pluginsByKind, kind), {
    onNone: () =>
      Effect.fail(
        new PluginNotFoundError({ descriptor: `${kind}:${name} (no ${kind} plugins were loaded)` }),
      ),
    onSome: (contributions) => findContribution(contributions, kind, name),
  })
}

export function create<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginContribution[]>,
  kind: K,
  name: string,
): Effect.Effect<ContributionOf<K>, PluginNotFoundError> {
  return findPlugin(pluginsByKind, kind, name)
}

export function createAll<K extends PluginKind>(
  pluginsByKind: HashMap.HashMap<PluginKind, readonly AnyPluginContribution[]>,
  kind: K,
): Effect.Effect<readonly ContributionOf<K>[]> {
  const contributions = HashMap.get(pluginsByKind, kind)
  if (Option.isNone(contributions)) {
    return Effect.succeed([])
  }
  return Effect.succeed(contributions.value.filter((c): c is ContributionOf<K> => c.kind === kind))
}
