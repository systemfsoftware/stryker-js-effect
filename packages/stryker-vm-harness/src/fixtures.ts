import * as Effect from 'effect/Effect'
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

const depsOf = (value: FixtureValue): Result.Result<ReadonlySet<string>, FixturePropsRejectionShape> => {
  if (!isFixtureFunction(value)) {
    return Result.succeed(new Set<string>())
  }
  return usedFixtureProps(value.toString())
}

interface FixturePropsRejectionShape {
  readonly reason: string
}

const normalizeOptions = (
  raw: FixtureOptions | undefined,
  parent: FixtureDefinition | undefined,
): Result.Result<NormalizedFixtureOptions, string> => {
  if (raw === undefined) {
    if (parent !== undefined) {
      return Result.succeed({ auto: parent.auto, injected: parent.injected, scope: parent.scope })
    }
    return Result.succeed({ auto: false, injected: false, scope: 'test' })
  }
  const scope = raw.scope ?? parent?.scope ?? 'test'
  const auto = raw.auto ?? parent?.auto ?? false
  if (parent !== undefined) {
    if (parent.scope !== scope) {
      return Result.fail(`The "${parent.name}" fixture was already registered with a "${scope}" scope.`)
    }
    if (parent.auto !== auto) {
      return Result.fail(`The "${parent.name}" fixture was already registered as { auto: ${String(auto)} }.`)
    }
  }
  return Result.succeed({ auto, injected: raw.injected ?? parent?.injected ?? false, scope })
}

const entryValueOf = (entry: FixtureTableValue): FixtureValue => isFixtureEntry(entry) ? entry[0] : entry

const entryOptionsOf = (entry: FixtureTableValue): FixtureOptions | undefined =>
  isFixtureEntry(entry) ? entry[1] : undefined

export interface ParsedFixtures {
  readonly definitions: Map<string, FixtureDefinition>
  readonly rejections: ReadonlyArray<string>
}

export const parseFixtureTable = (
  table: FixtureTable,
  base: ReadonlyMap<string, FixtureDefinition>,
  isTopLevel: boolean,
): ParsedFixtures => {
  const definitions = new Map(base)
  const rejections: string[] = []
  for (const [name, entry] of Object.entries(table)) {
    const rawOptions = entryOptionsOf(entry)
    const value = entryValueOf(entry)
    const parent = base.get(name)
    const options = normalizeOptions(rawOptions, parent)
    if (Result.isFailure(options)) {
      rejections.push(options.failure)
      continue
    }
    const normalized = options.success
    if (!FIXTURE_SCOPES.includes(normalized.scope)) {
      rejections.push(`The "${name}" fixture has unknown scope "${String(normalized.scope)}".`)
      continue
    }
    if (!isTopLevel && normalized.scope !== 'test') {
      const inherited = rawOptions?.scope === undefined && parent?.scope !== undefined
      rejections.push(
        `The "${name}" fixture cannot be defined with a ${normalized.scope} scope${
          inherited ? ' (inherited from the base fixture)' : ''
        } inside the describe block. Define it at the top level of the file instead.`,
      )
      continue
    }
    const deps = depsOf(value)
    if (Result.isFailure(deps)) {
      rejections.push(deps.failure.reason)
      continue
    }
    definitions.set(name, {
      name,
      value,
      auto: normalized.auto,
      injected: normalized.injected,
      scope: normalized.scope,
      deps: deps.success,
      parent,
    })
  }
  for (const fixture of definitions.values()) {
    for (const depName of fixture.deps) {
      if (BUILTIN_FIXTURES.includes(depName)) {
        continue
      }
      const dep = definitions.get(depName)
      if (dep === undefined) {
        rejections.push(`The "${fixture.name}" fixture depends on unknown fixture "${depName}".`)
        continue
      }
      if (depName === fixture.name && fixture.parent === undefined) {
        rejections.push(`The "${fixture.name}" fixture depends on itself, but does not have a base implementation.`)
        continue
      }
      if (scopeRankOf(fixture.scope) > scopeRankOf(dep.scope)) {
        rejections.push(
          `The ${fixture.scope} "${fixture.name}" fixture cannot depend on a ${dep.scope} fixture "${dep.name}".`,
        )
      }
    }
  }
  return { definitions, rejections }
}

export const definitionsFor = (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
): ReadonlyMap<string, FixtureDefinition> => {
  let current: FixtureHost | undefined = host
  while (current !== undefined) {
    const overridden = registry.overrides.get(current)
    if (overridden !== undefined) {
      return overridden
    }
    if (current.file !== undefined && current.file === current) {
      break
    }
    current = current.suite ?? current.file
  }
  return registry.definitions
}

export const extendFixtures = (
  registry: FixtureRegistry,
  table: FixtureTable,
  isTopLevel: boolean,
): Result.Result<FixtureRegistry, ReadonlyArray<string>> => {
  const parsed = parseFixtureTable(table, registry.definitions, isTopLevel)
  return parsed.rejections.length > 0
    ? Result.fail(parsed.rejections)
    : Result.succeed({ definitions: parsed.definitions, overrides: new Map() })
}

export const overrideFixtures = (
  registry: FixtureRegistry,
  host: FixtureHost | undefined,
  table: FixtureTable,
  isTopLevel: boolean,
): Result.Result<void, ReadonlyArray<string>> => {
  const base = host === undefined ? registry.definitions : definitionsFor(registry, host)
  const parsed = parseFixtureTable(table, new Map(base), isTopLevel)
  if (parsed.rejections.length > 0) {
    return Result.fail(parsed.rejections)
  }
  if (host === undefined) {
    registry.definitions.clear()
    for (const [name, definition] of parsed.definitions) {
      registry.definitions.set(name, definition)
    }
    return Result.succeed(undefined)
  }
  registry.overrides.set(host, parsed.definitions)
  return Result.succeed(undefined)
}

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

export const cleanupCountOf = (context: object): number => cleanups.get(context)?.length ?? 0

const runCleanup = (cleanup: () => Promise<void>): Effect.Effect<void> =>
  Effect.promise(() => Promise.resolve().then(cleanup))

export const cleanupFrom = (context: object, fromIndex: number): Effect.Effect<void> =>
  Effect.suspend(() => {
    const array = cleanups.get(context)
    if (array === undefined || array.length <= fromIndex) {
      return Effect.void
    }
    const pending = array.slice(fromIndex).reverse()
    array.length = fromIndex
    return Effect.forEach(pending, runCleanup, { discard: true })
  })

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
export const resolveFixtureValue = (
  fixture: FixtureDefinition,
  context: object,
  clean: Array<() => Promise<void>>,
): Effect.Effect<FixtureValue, string> => {
  if (!isFixtureFunction(fixture.value)) {
    return Effect.succeed(fixture.value)
  }
  const fixtureFn = fixture.value
  return Effect.suspend(() => resolveFixtureFunction(fixtureFn, fixture.name, context, clean))
}
