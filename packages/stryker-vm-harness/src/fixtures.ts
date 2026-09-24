import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { usedFixtureProps } from './fixture-props.js'

export type FixtureScope = 'test' | 'file' | 'worker'

export const FIXTURE_SCOPES: ReadonlyArray<FixtureScope> = ['test', 'file', 'worker']

export const BUILTIN_FIXTURES: ReadonlyArray<string> = [
  'task',
  'signal',
  'onTestFailed',
  'onTestFinished',
  'skip',
  'annotate',
  'bench',
]

const FIXTURE_OPTION_KEYS: ReadonlyArray<string> = ['auto', 'injected', 'scope']

export interface FixtureOptions {
  readonly auto?: boolean | undefined
  readonly injected?: boolean | undefined
  readonly scope?: FixtureScope | undefined
}

interface NormalizedFixtureOptions {
  readonly auto: boolean
  readonly injected: boolean
  readonly scope: FixtureScope
}

export type FixtureUse = (value: FixtureValue) => Promise<void>

export type FixtureFunction = (context: object, use: FixtureUse) => void

export type FixtureValue = FixtureFunction | object | string | number | boolean | null | undefined

export interface FixtureEntry extends ReadonlyArray<FixtureValue | FixtureOptions> {
  readonly 0: FixtureValue
  readonly 1: FixtureOptions
}

export type FixtureTableValue = FixtureValue | FixtureEntry

export type FixtureTable = Record<string, FixtureTableValue>

export const isFixtureEntry = (value: FixtureTableValue): value is FixtureEntry => Array.isArray(value)

export interface FixtureDefinition {
  readonly name: string
  readonly value: FixtureValue
  readonly auto: boolean
  readonly injected: boolean
  readonly scope: FixtureScope
  readonly deps: ReadonlySet<string>
  readonly parent: FixtureDefinition | undefined
}

export interface FixtureHost {
  readonly file?: FixtureHost | undefined
  readonly suite?: FixtureHost | undefined
}

export interface FixtureRegistry {
  readonly definitions: Map<string, FixtureDefinition>
  readonly overrides: Map<object, Map<string, FixtureDefinition>>
}

export const isFixtureOptions = (value: object): boolean => FIXTURE_OPTION_KEYS.some((key) => key in value)

export const isFixtureFunction = (value: FixtureValue): value is FixtureFunction => typeof value === 'function'

export const createFixtureRegistry = (): FixtureRegistry => ({
  definitions: new Map(),
  overrides: new Map(),
})

const scopeRankOf = (scope: FixtureScope): number => FIXTURE_SCOPES.indexOf(scope)

const depsOf = (value: FixtureValue): Result.Result<ReadonlySet<string>, string> =>
  isFixtureFunction(value)
    ? Result.mapError(usedFixtureProps(value.toString()), (rejection) => rejection.reason)
    : Result.succeed(new Set<string>())

const scopeProvided = (options: FixtureOptions | undefined): boolean =>
  Option.isSome(Option.flatMap(Option.fromNullishOr(options), (present) => Option.fromNullishOr(present.scope)))

const parentScopeProvided = (parent: FixtureDefinition | undefined): boolean =>
  Option.isSome(Option.map(Option.fromNullishOr(parent), (present) => present.scope))

const inheritedFromBase = (rawOptions: FixtureOptions | undefined, parent: FixtureDefinition | undefined): boolean =>
  !scopeProvided(rawOptions) && parentScopeProvided(parent)

const inheritedSuffix = (rawOptions: FixtureOptions | undefined, parent: FixtureDefinition | undefined): string =>
  inheritedFromBase(rawOptions, parent) ? ' (inherited from the base fixture)' : ''

const parentScopeOf = (parent: FixtureDefinition | undefined): FixtureScope =>
  Option.getOrElse(Option.map(Option.fromNullishOr(parent), (present) => present.scope), () => 'test')

const parentAutoOf = (parent: FixtureDefinition | undefined): boolean =>
  Option.getOrElse(Option.map(Option.fromNullishOr(parent), (present) => present.auto), () => false)

const parentInjectedOf = (parent: FixtureDefinition | undefined): boolean =>
  Option.getOrElse(Option.map(Option.fromNullishOr(parent), (present) => present.injected), () => false)

const mergedScope = (raw: FixtureOptions, parent: FixtureDefinition | undefined): FixtureScope =>
  Option.getOrElse(Option.fromNullishOr(raw.scope), () => parentScopeOf(parent))

const mergedAuto = (raw: FixtureOptions, parent: FixtureDefinition | undefined): boolean =>
  Option.getOrElse(Option.fromNullishOr(raw.auto), () => parentAutoOf(parent))

const mergedInjected = (raw: FixtureOptions, parent: FixtureDefinition | undefined): boolean =>
  Option.getOrElse(Option.fromNullishOr(raw.injected), () => parentInjectedOf(parent))

const scopeMismatch = (parent: FixtureDefinition, scope: FixtureScope): Result.Result<void, string> =>
  parent.scope === scope
    ? Result.succeed(undefined)
    : Result.fail(`The "${parent.name}" fixture was already registered with a "${scope}" scope.`)

const autoMismatch = (parent: FixtureDefinition, auto: boolean): Result.Result<void, string> =>
  parent.auto === auto
    ? Result.succeed(undefined)
    : Result.fail(`The "${parent.name}" fixture was already registered as { auto: ${String(auto)} }.`)

const parentMismatch = (
  parent: FixtureDefinition | undefined,
  scope: FixtureScope,
  auto: boolean,
): Result.Result<void, string> =>
  Option.match(Option.fromNullishOr(parent), {
    onNone: () => Result.succeed(undefined),
    onSome: (present) => Result.flatMap(scopeMismatch(present, scope), () => autoMismatch(present, auto)),
  })

const DEFAULT_OPTIONS: NormalizedFixtureOptions = { auto: false, injected: false, scope: 'test' }

const inheritedOptions = (parent: FixtureDefinition): NormalizedFixtureOptions => ({
  auto: parent.auto,
  injected: parent.injected,
  scope: parent.scope,
})

const mergeOptions = (
  raw: FixtureOptions,
  parent: FixtureDefinition | undefined,
): Result.Result<NormalizedFixtureOptions, string> => {
  const scope = mergedScope(raw, parent)
  const auto = mergedAuto(raw, parent)
  return Result.map(parentMismatch(parent, scope, auto), () => ({
    auto,
    injected: mergedInjected(raw, parent),
    scope,
  }))
}

const normalizeOptions = (
  raw: FixtureOptions | undefined,
  parent: FixtureDefinition | undefined,
): Result.Result<NormalizedFixtureOptions, string> =>
  Option.match(Option.fromNullishOr(raw), {
    onNone: () =>
      Option.match(Option.fromNullishOr(parent), {
        onNone: () => Result.succeed(DEFAULT_OPTIONS),
        onSome: (present) => Result.succeed(inheritedOptions(present)),
      }),
    onSome: (present) => mergeOptions(present, parent),
  })

const scopeKnown = (name: string, scope: FixtureScope): Result.Result<void, string> =>
  FIXTURE_SCOPES.includes(scope)
    ? Result.succeed(undefined)
    : Result.fail(`The "${name}" fixture has unknown scope "${String(scope)}".`)

const scopePlacementAllowed = (normalized: NormalizedFixtureOptions, isTopLevel: boolean): boolean =>
  isTopLevel || normalized.scope === 'test'

const scopePlacement = (
  name: string,
  normalized: NormalizedFixtureOptions,
  rawOptions: FixtureOptions | undefined,
  parent: FixtureDefinition | undefined,
  isTopLevel: boolean,
): Result.Result<void, string> =>
  scopePlacementAllowed(normalized, isTopLevel)
    ? Result.succeed(undefined)
    : Result.fail(
      `The "${name}" fixture cannot be defined with a ${normalized.scope} scope${
        inheritedSuffix(rawOptions, parent)
      } inside the describe block. Define it at the top level of the file instead.`,
    )

const checkedOptions = (
  name: string,
  rawOptions: FixtureOptions | undefined,
  parent: FixtureDefinition | undefined,
  isTopLevel: boolean,
): Result.Result<NormalizedFixtureOptions, string> =>
  Result.flatMap(
    normalizeOptions(rawOptions, parent),
    (normalized) =>
      Result.flatMap(scopeKnown(name, normalized.scope), () =>
        Result.map(scopePlacement(name, normalized, rawOptions, parent, isTopLevel), () => normalized)),
  )

const entryValueOf = (entry: FixtureTableValue): FixtureValue => isFixtureEntry(entry) ? entry[0] : entry

const entryOptionsOf = (entry: FixtureTableValue): FixtureOptions | undefined =>
  isFixtureEntry(entry) ? entry[1] : undefined

const definitionOf = (
  name: string,
  entry: FixtureTableValue,
  base: ReadonlyMap<string, FixtureDefinition>,
  isTopLevel: boolean,
): Result.Result<FixtureDefinition, string> => {
  const rawOptions = entryOptionsOf(entry)
  const value = entryValueOf(entry)
  const parent = base.get(name)
  return Result.flatMap(
    checkedOptions(name, rawOptions, parent, isTopLevel),
    (normalized) =>
      Result.map(depsOf(value), (deps): FixtureDefinition => ({
        name,
        value,
        auto: normalized.auto,
        injected: normalized.injected,
        scope: normalized.scope,
        deps,
        parent,
      })),
  )
}

interface ParsedFixtures {
  readonly definitions: Map<string, FixtureDefinition>
  readonly rejections: ReadonlyArray<string>
}

interface ParseState {
  readonly definitions: Map<string, FixtureDefinition>
  readonly rejections: Array<string>
}

const parseEntryInto = (
  state: ParseState,
  name: string,
  entry: FixtureTableValue,
  base: ReadonlyMap<string, FixtureDefinition>,
  isTopLevel: boolean,
): void =>
  Result.match(definitionOf(name, entry, base, isTopLevel), {
    onFailure: (rejection) => {
      state.rejections.push(rejection)
    },
    onSuccess: (definition) => {
      state.definitions.set(name, definition)
    },
  })

const parseEntries = (
  table: FixtureTable,
  base: ReadonlyMap<string, FixtureDefinition>,
  isTopLevel: boolean,
): ParseState => {
  const state: ParseState = { definitions: new Map(base), rejections: [] }
  for (const [name, entry] of Object.entries(table)) {
    parseEntryInto(state, name, entry, base, isTopLevel)
  }
  return state
}

const selfDependency = (fixture: FixtureDefinition, dep: FixtureDefinition): string | undefined =>
  Match.value(dep.name === fixture.name && fixture.parent === undefined).pipe(
    Match.when(true, () => `The "${fixture.name}" fixture depends on itself, but does not have a base implementation.`),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )

const scopeDependency = (fixture: FixtureDefinition, dep: FixtureDefinition): string | undefined =>
  Match.value(scopeRankOf(fixture.scope) > scopeRankOf(dep.scope)).pipe(
    Match.when(
      true,
      () => `The ${fixture.scope} "${fixture.name}" fixture cannot depend on a ${dep.scope} fixture "${dep.name}".`,
    ),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )

const dependencyRejection = (
  fixture: FixtureDefinition,
  depName: string,
  definitions: ReadonlyMap<string, FixtureDefinition>,
): string | undefined =>
  Option.match(Option.fromNullishOr(definitions.get(depName)), {
    onNone: () => `The "${fixture.name}" fixture depends on unknown fixture "${depName}".`,
    onSome: (dep) => selfDependency(fixture, dep) ?? scopeDependency(fixture, dep),
  })

const asArray = (value: string | undefined): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(value), {
    onNone: (): ReadonlyArray<string> => [],
    onSome: (present) => [present],
  })

const dependencyRejections = (definitions: ReadonlyMap<string, FixtureDefinition>): ReadonlyArray<string> =>
  [...definitions.values()].flatMap((fixture) =>
    [...fixture.deps]
      .filter((depName) => !BUILTIN_FIXTURES.includes(depName))
      .flatMap((depName) => asArray(dependencyRejection(fixture, depName, definitions)))
  )

const parseFixtureTable = (
  table: FixtureTable,
  base: ReadonlyMap<string, FixtureDefinition>,
  isTopLevel: boolean,
): ParsedFixtures => {
  const parsed = parseEntries(table, base, isTopLevel)
  return {
    definitions: parsed.definitions,
    rejections: [...parsed.rejections, ...dependencyRejections(parsed.definitions)],
  }
}

const overrideFor = (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
): ReadonlyMap<string, FixtureDefinition> | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.fromNullishOr(host),
      (present) => Option.fromNullishOr(registry.overrides.get(present)),
    ),
  )

const isSelfReferential = (current: FixtureHost): boolean => current.file === current

const nextHostOf = (current: FixtureHost): FixtureHost | undefined =>
  isSelfReferential(current)
    ? undefined
    : Option.getOrElse(Option.fromNullishOr(current.suite), () => current.file)

const definitionsForImpl = (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
): ReadonlyMap<string, FixtureDefinition> => {
  const overridden = overrideFor(registry, host)
  if (overridden !== undefined) {
    return overridden
  }
  return Option.match(Option.fromNullishOr(host), {
    onNone: () => registry.definitions,
    onSome: (present) => definitionsForImpl(registry, nextHostOf(present)),
  })
}

export const definitionsFor = dual<
  (host: FixtureHost | undefined) => (registry: FixtureRegistry) => ReadonlyMap<string, FixtureDefinition>,
  (registry: FixtureRegistry, host: FixtureHost | undefined) => ReadonlyMap<string, FixtureDefinition>
>(
  2,
  (registry: FixtureRegistry, host: FixtureHost | undefined): ReadonlyMap<string, FixtureDefinition> =>
    definitionsForImpl(registry, host),
)

const rejectionResultOf = <A>(
  rejections: ReadonlyArray<string>,
  value: A,
): Result.Result<A, ReadonlyArray<string>> => rejections.length > 0 ? Result.fail(rejections) : Result.succeed(value)

export const extendFixtures = dual<
  (
    table: FixtureTable,
    isTopLevel: boolean,
  ) => (registry: FixtureRegistry) => Result.Result<FixtureRegistry, ReadonlyArray<string>>,
  (
    registry: FixtureRegistry,
    table: FixtureTable,
    isTopLevel: boolean,
  ) => Result.Result<FixtureRegistry, ReadonlyArray<string>>
>(3, (registry: FixtureRegistry, table: FixtureTable, isTopLevel: boolean): Result.Result<
  FixtureRegistry,
  ReadonlyArray<string>
> => {
  const parsed = parseFixtureTable(table, registry.definitions, isTopLevel)
  return rejectionResultOf(parsed.rejections, { definitions: parsed.definitions, overrides: new Map() })
})

const baseDefinitionsFor = (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
): ReadonlyMap<string, FixtureDefinition> => host === undefined ? registry.definitions : definitionsFor(registry, host)

const replaceDefinitions = (registry: FixtureRegistry, definitions: Map<string, FixtureDefinition>): void => {
  registry.definitions.clear()
  for (const [name, definition] of definitions) {
    registry.definitions.set(name, definition)
  }
}

const applyOverride = (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
  definitions: Map<string, FixtureDefinition>,
): Result.Result<void, ReadonlyArray<string>> =>
  Option.match(Option.fromNullishOr(host), {
    onNone: () => {
      replaceDefinitions(registry, definitions)
      return Result.succeed(undefined)
    },
    onSome: (present) => {
      registry.overrides.set(present, definitions)
      return Result.succeed(undefined)
    },
  })

export const overrideFixtures = dual<
  (
    host: FixtureHost | undefined,
    table: FixtureTable,
    isTopLevel: boolean,
  ) => (registry: FixtureRegistry) => Result.Result<void, ReadonlyArray<string>>,
  (
    registry: FixtureRegistry,
    host: FixtureHost | undefined,
    table: FixtureTable,
    isTopLevel: boolean,
  ) => Result.Result<void, ReadonlyArray<string>>
>(4, (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
  table: FixtureTable,
  isTopLevel: boolean,
): Result.Result<void, ReadonlyArray<string>> => {
  const parsed = parseFixtureTable(table, new Map(baseDefinitionsFor(registry, host)), isTopLevel)
  return Result.flatMap(
    rejectionResultOf(parsed.rejections, undefined),
    () => applyOverride(registry, host, parsed.definitions),
  )
})

const cleanups = new WeakMap<object, Array<() => Promise<void>>>()

export const cleanupArrayOf = (context: object): Array<() => Promise<void>> => {
  const existing = cleanups.get(context)
  if (existing !== undefined) {
    return existing
  }
  const created: Array<() => Promise<void>> = []
  cleanups.set(context, created)
  return created
}

export const cleanupCountOf = (context: object): number =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(cleanups.get(context)), (present) => present.length),
    () => 0,
  )

const runCleanup = (cleanup: () => Promise<void>): Effect.Effect<void> =>
  Effect.promise(() => Promise.resolve().then(cleanup))

const trimAndRun = (array: Array<() => Promise<void>>, fromIndex: number): Effect.Effect<void> => {
  const pending = array.slice(fromIndex).reverse()
  array.length = fromIndex
  return Effect.forEach(pending, runCleanup, { discard: true })
}

const pendingCleanups = (array: Array<() => Promise<void>>, fromIndex: number): Effect.Effect<void> =>
  Match.value(array.length <= fromIndex).pipe(
    Match.when(true, () => Effect.void),
    Match.when(false, () => trimAndRun(array, fromIndex)),
    Match.exhaustive,
  )

const cleanupFromEffect = (context: object, fromIndex: number): Effect.Effect<void> =>
  Option.match(Option.fromNullishOr(cleanups.get(context)), {
    onNone: () => Effect.void,
    onSome: (array) => pendingCleanups(array, fromIndex),
  })

export const cleanupFrom = dual<
  (fromIndex: number) => (context: object) => Effect.Effect<void>,
  (context: object, fromIndex: number) => Effect.Effect<void>
>(
  2,
  (context: object, fromIndex: number): Effect.Effect<void> =>
    Effect.suspend(() => cleanupFromEffect(context, fromIndex)),
)

export const cleanupAll = (context: object): Effect.Effect<void> =>
  Effect.suspend(() => {
    const array = cleanups.get(context)
    if (array === undefined) {
      return Effect.void
    }
    cleanups.delete(context)
    return Effect.forEach([...array].reverse(), runCleanup, { discard: true })
  })

const messageOf = <A = unknown>(cause: A): string =>
  cause instanceof Error ? cause.message : new Error('fixture failure', { cause }).message

const resolveFixtureFunction = (
  fixtureFn: FixtureFunction,
  fixtureName: string,
  context: object,
  clean: Array<() => Promise<void>>,
): Effect.Effect<FixtureValue, string> =>
  Effect.callback<FixtureValue, string>((resume) => {
    let useCalled = false
    const useArgument = Promise.withResolvers<FixtureValue>()
    const teardownGate = Promise.withResolvers<void>()
    let fixtureReturn: Promise<void> = Promise.resolve()
    fixtureReturn = Promise.resolve()
      .then(() =>
        fixtureFn(context, (value: FixtureValue) => {
          useCalled = true
          useArgument.resolve(value)
          clean.push(() => {
            teardownGate.resolve()
            return fixtureReturn.then(() => undefined)
          })
          return teardownGate.promise
        })
      )
      .then(
        () => {
          if (!useCalled) {
            useArgument.reject(
              new Error(
                `Fixture "${fixtureName}" returned without calling "use". Make sure to call "use" in every code path of the fixture function.`,
              ),
            )
          }
        },
        <A2 = unknown>(cause: A2) => {
          if (!useCalled) {
            useArgument.reject(cause)
          }
        },
      )
    void useArgument.promise.then(
      (value) => resume(Effect.succeed(value)),
      <A3 = unknown>(cause: A3) => resume(Effect.fail(messageOf(cause))),
    )
  })

export const resolveFixtureValue = dual<
  (
    context: object,
    clean: Array<() => Promise<void>>,
  ) => (fixture: FixtureDefinition) => Effect.Effect<FixtureValue, string>,
  (
    fixture: FixtureDefinition,
    context: object,
    clean: Array<() => Promise<void>>,
  ) => Effect.Effect<FixtureValue, string>
>(3, (fixture: FixtureDefinition, context: object, clean: Array<() => Promise<void>>): Effect.Effect<
  FixtureValue,
  string
> => {
  const value = fixture.value
  return isFixtureFunction(value)
    ? Effect.suspend(() => resolveFixtureFunction(value, fixture.name, context, clean))
    : Effect.succeed(value)
})
