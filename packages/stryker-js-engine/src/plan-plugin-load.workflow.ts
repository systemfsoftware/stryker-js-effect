import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Array from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PluginLoadDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-engine/PluginLoadDecision')
type PluginLoadDecisionTypeId = typeof PluginLoadDecisionTypeId

export class ResolvedSpecifier extends S.TaggedClass<ResolvedSpecifier>()('ResolvedSpecifier', {
  specifier: S.String,
  entrypoint: S.String,
}) {}

export class UnresolvedSpecifier extends S.TaggedClass<UnresolvedSpecifier>()('UnresolvedSpecifier', {
  specifier: S.String,
  reason: S.String,
}) {}

const SpecifierResolution = S.Union([ResolvedSpecifier, UnresolvedSpecifier])

export class PluginLoadCommand extends S.TaggedClass<PluginLoadCommand>()('PluginLoadCommand', {
  specifiers: S.Array(S.String),
  resolutions: S.Array(SpecifierResolution),
}) {}

export class PluginsResolved extends S.TaggedClass<PluginsResolved>()('PluginsResolved', {
  toLoad: S.Array(ResolvedSpecifier),
}) {
  readonly [PluginLoadDecisionTypeId] = PluginLoadDecisionTypeId
}

export class PluginsPartiallyResolved extends S.TaggedClass<PluginsPartiallyResolved>()('PluginsPartiallyResolved', {
  toLoad: S.Array(ResolvedSpecifier),
  unresolved: S.Array(UnresolvedSpecifier),
}) {
  readonly [PluginLoadDecisionTypeId] = PluginLoadDecisionTypeId
}

export type PluginLoadDecision = PluginsResolved | PluginsPartiallyResolved

export class PluginSelectionError extends S.TaggedError<PluginSelectionError>()('PluginSelectionError', {
  stage: S.Literals(['prepare']),
  reason: S.String,
  unresolved: S.Array(UnresolvedSpecifier),
}) {}

const MISSING_PLUGIN_REASON =
  'Stryker resolved no plugins. The `testRunner` and `checkers` configured for this run have no plugin providing them; list the plugin packages that provide them in the "plugins" (or "appendPlugins") array of the Stryker config.'

const reasonFor = (unresolved: readonly UnresolvedSpecifier[]): string =>
  Array.match(unresolved, {
    onEmpty: (): string => MISSING_PLUGIN_REASON,
    onNonEmpty: (missed): string =>
      `${MISSING_PLUGIN_REASON} Unresolved specifier(s): ${missed.map((entry) => entry.specifier).join(', ')}.`,
  })

const uniqueSpecifiers = (specifiers: readonly string[]): readonly string[] =>
  specifiers.filter((specifier, index) => specifiers.indexOf(specifier) === index)

const DotRelative = S.String.pipe(S.check(S.isStartsWith('.')))
const Rooted = S.String.pipe(S.check(S.isStartsWith('/')))
const WindowsRooted = S.String.pipe(S.check(S.isStartsWith('\\')))
const FileUrl = S.String.pipe(S.check(S.isStartsWith('file:')))

export const PathPrefixedSpecifier = S.Union([DotRelative, Rooted, WindowsRooted, FileUrl])

const pathPrefixedSpecifiers = (specifiers: readonly string[]): readonly string[] =>
  uniqueSpecifiers(specifiers).filter((specifier) => S.is(PathPrefixedSpecifier)(specifier))

const PATH_PREFIXED_REASON =
  'Path-prefixed plugin specifiers are not supported: plugins load as packages resolved from the project. Install the plugin as a dependency (a local plugin can be a "file:" dependency) and list its package name in "plugins" (or "appendPlugins"). Path-prefixed specifier(s): '

const pathPrefixedReason = (prefixed: readonly string[]): string => `${PATH_PREFIXED_REASON}${prefixed.join(', ')}.`

const outcomeFor = (
  specifier: string,
  resolutions: readonly (ResolvedSpecifier | UnresolvedSpecifier)[],
): ResolvedSpecifier | UnresolvedSpecifier =>
  Option.match(Option.fromUndefinedOr(resolutions.find((resolution) => resolution.specifier === specifier)), {
    onNone: () => UnresolvedSpecifier.make({ specifier, reason: 'no resolution was reported for this specifier' }),
    onSome: (resolution) => resolution,
  })

const decide = (
  toLoad: readonly ResolvedSpecifier[],
  unresolved: readonly UnresolvedSpecifier[],
): Result.Result<PluginLoadDecision, PluginSelectionError> =>
  Array.match(toLoad, {
    onEmpty: () =>
      Result.fail(PluginSelectionError.make({ stage: 'prepare', reason: reasonFor(unresolved), unresolved })),
    onNonEmpty: (loadable) =>
      Result.succeed(
        Array.match(unresolved, {
          onEmpty: () => PluginsResolved.make({ toLoad: loadable }),
          onNonEmpty: (missed) => PluginsPartiallyResolved.make({ toLoad: loadable, unresolved: missed }),
        }),
      ),
  })

const resolveDeclared = (
  command: PluginLoadCommand,
): Result.Result<PluginLoadDecision, PluginSelectionError> => {
  const reported = uniqueSpecifiers(command.specifiers).map((specifier) => outcomeFor(specifier, command.resolutions))
  return decide(
    reported.filter((resolution): resolution is ResolvedSpecifier => S.is(ResolvedSpecifier)(resolution)),
    reported.filter((resolution): resolution is UnresolvedSpecifier => S.is(UnresolvedSpecifier)(resolution)),
  )
}

const refusePathPrefixed = (
  prefixed: readonly string[],
): Result.Result<PluginLoadDecision, PluginSelectionError> =>
  Result.fail(PluginSelectionError.make({ stage: 'prepare', reason: pathPrefixedReason(prefixed), unresolved: [] }))

export const planPluginLoad = Workflow.make(
  PluginLoadCommand,
  (command: PluginLoadCommand): Result.Result<PluginLoadDecision, PluginSelectionError> =>
    Array.match(pathPrefixedSpecifiers(command.specifiers), {
      onEmpty: () => resolveDeclared(command),
      onNonEmpty: refusePathPrefixed,
    }),
)
