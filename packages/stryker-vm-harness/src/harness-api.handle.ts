import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { usedFixtureProps } from './fixture-props.js'
import { createFixtureRegistry, extendFixtures, overrideFixtures } from './fixtures.js'
import type {
  FixtureFunction,
  FixtureHost,
  FixtureOptions,
  FixtureRegistry,
  FixtureTable,
  FixtureTableValue,
  FixtureUse,
  FixtureValue,
} from './fixtures.js'
import { tagsForChain } from './registry.handle.js'
import type {
  AroundHookFunction,
  AroundKind,
  AroundSets,
  BuilderExtendApi,
  BuilderFixtureOptions,
  BuilderOverrideApi,
  BuilderScopedApi,
  BuilderScopeName,
  ChainableVariantApi,
  EachApi,
  EachFn,
  EachNameOptions,
  EachSuiteBody,
  EachValue,
  EachValueFormatter,
  ForApi,
  ForFn,
  ForSuiteBody,
  HarnessApi,
  HarnessHookFunction,
  HarnessTestContext,
  HarnessTestFunction,
  HookApi,
  HookKind,
  HookSets,
  ParsedTestArguments,
  RegisteredSuite,
  RegistrySuiteApi,
  RegistryTestApi,
  RetryOptions,
  SuiteBody,
  SuiteEachApi,
  SuiteForApi,
  SuiteOptions,
  SuiteRegistration,
  SuiteVariants,
  TemplateRow,
  TestContext,
  TestFunctionWithTimeout,
  TestMode,
  TestOptions,
  TestRegistration,
  TestRegistry,
  VariantApi,
} from './registry.schema.js'

const { createRequire } = globalThis.process.getBuiltinModule('node:module')

const DEPRECATED_THIRD_ARGUMENT_MESSAGE =
  'Signature "test(name, fn, { ... })" was deprecated in Vitest 3 and removed in Vitest 4. Please, provide options as a second argument instead.'

const TWO_FUNCTIONS_MESSAGE = 'Cannot use two functions as arguments. Please use the second argument for options.'

const assertNotDeprecatedThirdArgument = (value: TestFunctionWithTimeout | number | undefined): void => {
  if (typeof value === 'object') {
    throw new TypeError(DEPRECATED_THIRD_ARGUMENT_MESSAGE)
  }
}

const bothFunctions = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFnOrTimeout: TestFunctionWithTimeout | number | undefined,
): boolean => typeof fnOrOptions === 'function' && typeof maybeFnOrTimeout === 'function'

const assertNotTwoFunctions = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFnOrTimeout: TestFunctionWithTimeout | number | undefined,
): void => {
  if (bothFunctions(fnOrOptions, maybeFnOrTimeout)) {
    throw new TypeError(TWO_FUNCTIONS_MESSAGE)
  }
}

const functionOptionsOf = (value: TestFunctionWithTimeout | TestOptions | undefined): TestOptions =>
  typeof value === 'object' ? value : {}

const argumentsOptionsOf = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFnOrTimeout: TestFunctionWithTimeout | number | undefined,
): TestOptions =>
  Match.value(maybeFnOrTimeout).pipe(
    Match.when(Match.number, (timeout: number): TestOptions => ({ timeout })),
    Match.orElse(() => functionOptionsOf(fnOrOptions)),
  )

const functionArgumentOf = (
  value: TestFunctionWithTimeout | TestOptions | number | undefined,
): HarnessTestFunction | undefined => (typeof value === 'function' ? value : undefined)

const argumentsFnOf = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFnOrTimeout: TestFunctionWithTimeout | number | undefined,
): HarnessTestFunction | undefined => functionArgumentOf(fnOrOptions) ?? functionArgumentOf(maybeFnOrTimeout)

const parseTestArguments = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFnOrTimeout: TestFunctionWithTimeout | number | undefined,
): ParsedTestArguments => {
  assertNotDeprecatedThirdArgument(maybeFnOrTimeout)
  assertNotTwoFunctions(fnOrOptions, maybeFnOrTimeout)
  return {
    options: argumentsOptionsOf(fnOrOptions, maybeFnOrTimeout),
    fn: argumentsFnOf(fnOrOptions, maybeFnOrTimeout),
  }
}

const MODE_FLAGS: ReadonlyArray<readonly ['only' | 'skip' | 'todo', TestMode]> = [
  ['only', 'only'],
  ['skip', 'skip'],
  ['todo', 'todo'],
]

const declaredModeOf = (flags: TestOptions): TestMode => {
  const declared = MODE_FLAGS.find(([key]) => flags[key] === true)
  return declared === undefined ? 'run' : declared[1]
}

const isBodilessRun = (mode: TestMode, hasFn: boolean): boolean => mode === 'run' && !hasFn

const modeOf = (flags: TestOptions, hasFn: boolean): TestMode => {
  const declared = declaredModeOf(flags)
  return isBodilessRun(declared, hasFn) ? 'todo' : declared
}

interface BuilderCleanupRegistrar {
  (fn: () => void | Promise<void>): void
}

export type BuilderFunctionContext = FixtureUse & {
  readonly onCleanup: BuilderCleanupRegistrar
}

export type BuilderFunction = (
  context: object,
  registrar: BuilderFunctionContext,
) => FixtureValue | Promise<FixtureValue> | void

const EACH_VALUE_TYPEOF: Record<string, true> = {
  undefined: true,
  object: true,
  boolean: true,
  number: true,
  bigint: true,
  string: true,
  symbol: true,
  function: true,
}

const isEachValue = <A>(value: A): value is A & EachValue => EACH_VALUE_TYPEOF[typeof value] === true

const eachValueOf = <A>(value: A): EachValue => {
  if (isEachValue(value)) {
    return value
  }
  return String(value)
}

const isFunctionValue = (value: EachValue | undefined): boolean => typeof value === 'function'

interface TextCoercible {
  readonly toString: () => string
}

type TextScalar = null | undefined | string | number | boolean | bigint | symbol | TextCoercible

const isTextScalar = (value: EachValue): value is TextScalar => value === null || typeof value !== 'object'

const isFnArgumentOf = <F extends EachValue>(value: EachValue | undefined): value is F => typeof value === 'function'

const isObjectLike = (value: EachValue): value is Record<string, EachValue> =>
  typeof value === 'object' && value !== null

const isObjectValue = (value: EachValue): value is object => isObjectLike(value) && !Array.isArray(value)

const isTemplateTable = (cases: unknown): cases is TemplateStringsArray =>
  Array.isArray(cases) && Object.hasOwn(cases, 'raw')

const templateHeaderOf = (cases: TemplateStringsArray): ReadonlyArray<string> =>
  cases
    .join('')
    .trim()
    .replace(/ /gu, '')
    .split('\n')
    .map((line) => line.split('|'))[0] ?? []

const templateRowOf = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<EachValue>,
  index: number,
): TemplateRow => {
  const row: TemplateRow = {}
  header.forEach((key, column) => {
    row[key] = rows[index * header.length + column]
  })
  return row
}

const templateRowsOf = (
  cases: TemplateStringsArray,
  rows: ReadonlyArray<EachValue>,
): ReadonlyArray<TemplateRow> => {
  const header = templateHeaderOf(cases)
  const table: Array<TemplateRow> = []
  for (let index = 0; index < Math.floor(rows.length / header.length); index += 1) {
    table.push(templateRowOf(header, rows, index))
  }
  return table
}

const isRegisteredSuite = (suite: RegisteredSuite | undefined): suite is RegisteredSuite => suite !== undefined

const suiteChainOf = (registry: TestRegistry): ReadonlyArray<RegisteredSuite> =>
  registry.frames.current.map((id) => registry.suites.get(id)).filter(isRegisteredSuite)

const inheritedOf = <A>(
  chain: ReadonlyArray<RegisteredSuite>,
  pick: (suite: RegisteredSuite) => A | undefined,
): A | undefined => {
  const found = [...chain].reverse().find((suite) => pick(suite) !== undefined)
  return found === undefined ? undefined : pick(found)
}

const suiteTimeoutOf = (suite: RegisteredSuite): number | undefined => suite.timeout
const suiteRetryOf = (suite: RegisteredSuite): number | RetryOptions | undefined => suite.retry
const suiteRepeatsOf = (suite: RegisteredSuite): number | undefined => suite.repeats

const isConcurrentSuite = (suite: RegisteredSuite): boolean => suite.concurrent === true
const isShuffledSuite = (suite: RegisteredSuite): boolean => suite.shuffle === true

const concurrentOf = (merged: TestOptions, chain: ReadonlyArray<RegisteredSuite>): boolean =>
  merged.concurrent ?? chain.some(isConcurrentSuite)

const timeoutOptionOf = (merged: TestOptions, chain: ReadonlyArray<RegisteredSuite>): number | undefined =>
  merged.timeout ?? inheritedOf(chain, suiteTimeoutOf)

const retryOptionOf = (
  merged: TestOptions,
  chain: ReadonlyArray<RegisteredSuite>,
): number | RetryOptions | undefined => merged.retry ?? inheritedOf(chain, suiteRetryOf)

const repeatsOptionOf = (merged: TestOptions, chain: ReadonlyArray<RegisteredSuite>): number | undefined =>
  merged.repeats ?? inheritedOf(chain, suiteRepeatsOf)

const chainOptionsOf = (
  registry: TestRegistry,
  merged: TestOptions,
): Pick<TestRegistration, 'timeout' | 'retry' | 'repeats' | 'concurrent' | 'shuffle'> => {
  const chain = suiteChainOf(registry)
  return {
    timeout: timeoutOptionOf(merged, chain),
    retry: retryOptionOf(merged, chain),
    repeats: repeatsOptionOf(merged, chain),
    concurrent: concurrentOf(merged, chain),
    shuffle: chain.some(isShuffledSuite),
  }
}

const tagsOf = (tags: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> | undefined =>
  typeof tags === 'string' ? [tags] : copyTagsOf(tags)

const copyTagsOf = (tags: ReadonlyArray<string> | undefined): ReadonlyArray<string> | undefined =>
  tags === undefined ? undefined : [...tags]

const fixtureNamesOf = (fn: { readonly toString: () => string }): ReadonlySet<string> => {
  const parsed = usedFixtureProps(fn.toString(), 1)
  return Result.isSuccess(parsed) ? parsed.success : new Set<string>()
}

const argsOfRow = <A>(row: A): ReadonlyArray<A> => {
  const args: ReadonlyArray<A> = Array.isArray(row) ? row : [row]
  return args
}

interface CollectorBase {
  readonly inverted: boolean
  readonly flags: TestOptions
  readonly fixtures: FixtureRegistry | undefined
}

const invertedOf = (base: CollectorBase, merged: TestOptions): boolean => base.inverted || merged.fails === true

const eachFlagOf = (merged: TestOptions): boolean => merged.each ?? false

const registerCollected = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
  name: string,
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFn: TestFunctionWithTimeout | number | undefined,
): void => {
  const parsed = parseTestArguments(fnOrOptions, maybeFn)
  const merged: TestOptions = { ...base.flags, ...flags, ...parsed.options }
  registry.registerTest(
    name,
    registry.frames.current,
    modeOf(merged, parsed.fn !== undefined),
    invertedOf(base, merged),
    parsed.fn,
    {
      ...chainOptionsOf(registry, merged),
      each: eachFlagOf(merged),
      tags: tagsForChain(registry, registry.frames.current, tagsOf(merged.tags)),
      fixtures: base.fixtures,
    },
  )
}

interface RowsBinder<F extends EachValue> {
  (rows: ReadonlyArray<EachValue>): (name: string, fn: F) => void
}

const isNameArgument = (rest: ReadonlyArray<EachValue>): boolean => typeof rest[0] === 'string'

const nameArgumentOf = (rest: ReadonlyArray<EachValue>): string => {
  const name = rest[0]
  return typeof name === 'string' ? name : ''
}

const fnArgumentOf = <F extends EachValue>(rest: ReadonlyArray<EachValue>): F | undefined => {
  const fn = rest[1]
  return isFnArgumentOf<F>(fn) ? fn : undefined
}

const hasNamedArguments = (rest: ReadonlyArray<EachValue>): boolean => isNameArgument(rest) && isFunctionValue(rest[1])

const isPlainRowsArray = (
  cases: ReadonlyArray<EachValue> | TemplateStringsArray,
): cases is ReadonlyArray<EachValue> => Array.isArray(cases) && !isTemplateTable(cases)

const isNamedRowsCall = (
  cases: ReadonlyArray<EachValue> | TemplateStringsArray,
  rest: ReadonlyArray<EachValue>,
): cases is ReadonlyArray<EachValue> => hasNamedArguments(rest) && isPlainRowsArray(cases)

const bindRowsOrEmpty = <F extends EachValue>(
  cases: ReadonlyArray<EachValue> | TemplateStringsArray,
  bind: RowsBinder<F>,
): (name: string, fn: F) => void => (Array.isArray(cases) ? bind(cases) : bind([]))

const bindNamedRows = <F extends EachValue>(
  cases: ReadonlyArray<EachValue>,
  rest: ReadonlyArray<EachValue>,
  bind: RowsBinder<F>,
): void | ((name: string, fn: F) => void) => {
  const fn = fnArgumentOf<F>(rest)
  return fn === undefined ? bind([]) : bind(cases)(nameArgumentOf(rest), fn)
}

const namedRowsBinderOf = <F extends EachValue>(
  cases: ReadonlyArray<EachValue> | TemplateStringsArray,
  rest: ReadonlyArray<EachValue>,
  bind: RowsBinder<F>,
): void | ((name: string, fn: F) => void) => isNamedRowsCall(cases, rest) ? bindNamedRows(cases, rest, bind) : bind([])

const arrayRowsCallOf = <F extends EachValue>(
  cases: ReadonlyArray<EachValue> | TemplateStringsArray,
  rest: ReadonlyArray<EachValue>,
  bind: RowsBinder<F>,
): void | ((name: string, fn: F) => void) =>
  rest.length === 0 ? bindRowsOrEmpty(cases, bind) : namedRowsBinderOf(cases, rest, bind)

const tableRowsBinderOf = <F extends EachValue>(
  cases: TemplateStringsArray,
  rest: ReadonlyArray<EachValue>,
  bind: RowsBinder<F>,
): (name: string, fn: F) => void => bind(templateRowsOf(cases, rest))

const rowsCallOf = <F extends EachValue>(
  cases: ReadonlyArray<EachValue> | TemplateStringsArray,
  rest: ReadonlyArray<EachValue>,
  bind: RowsBinder<F>,
): void | ((name: string, fn: F) => void) =>
  isTemplateTable(cases) ? tableRowsBinderOf(cases, rest, bind) : arrayRowsCallOf(cases, rest, bind)

const eachApiOf = (bind: RowsBinder<EachFn<EachValue>>): EachApi => {
  function eachRows(
    cases: TemplateStringsArray,
    ...rows: ReadonlyArray<EachValue>
  ): (name: string, fn: EachFn<TemplateRow>) => void
  function eachRows<A>(
    cases: readonly A[],
    name?: string,
    fn?: EachFn<A>,
  ): void | ((name: string, fn: EachFn<A>) => void)
  function eachRows(
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ): void | ((name: string, fn: EachFn<EachValue>) => void) {
    return rowsCallOf(cases, rest, bind)
  }
  return eachRows
}

const forApiOf = (bind: RowsBinder<ForFn<EachValue>>): ForApi => {
  function forRows(
    cases: TemplateStringsArray,
    ...rows: ReadonlyArray<EachValue>
  ): (name: string, fn: ForFn<TemplateRow>) => void
  function forRows<A>(cases: readonly A[], name?: string, fn?: ForFn<A>): void | ((name: string, fn: ForFn<A>) => void)
  function forRows(
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ): void | ((name: string, fn: ForFn<EachValue>) => void) {
    return rowsCallOf(cases, rest, bind)
  }
  return forRows
}

const suiteEachApiOf = (bind: RowsBinder<EachSuiteBody<EachValue>>): SuiteEachApi => {
  function eachRows(
    cases: TemplateStringsArray,
    ...rows: ReadonlyArray<EachValue>
  ): (name: string, body: EachSuiteBody<TemplateRow>) => void
  function eachRows<A>(
    cases: readonly A[],
    name?: string,
    body?: EachSuiteBody<A>,
  ): void | ((name: string, body: EachSuiteBody<A>) => void)
  function eachRows(
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ): void | ((name: string, body: EachSuiteBody<EachValue>) => void) {
    return rowsCallOf(cases, rest, bind)
  }
  return eachRows
}

const suiteForApiOf = (bind: RowsBinder<ForSuiteBody<EachValue>>): SuiteForApi => {
  function forRows(
    cases: TemplateStringsArray,
    ...rows: ReadonlyArray<EachValue>
  ): (name: string, body: ForSuiteBody<TemplateRow>) => void
  function forRows<A>(
    cases: readonly A[],
    name?: string,
    body?: ForSuiteBody<A>,
  ): void | ((name: string, body: ForSuiteBody<A>) => void)
  function forRows(
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ): void | ((name: string, body: ForSuiteBody<EachValue>) => void) {
    return rowsCallOf(cases, rest, bind)
  }
  return forRows
}

const eachRowsRegistrationOf = (
  registry: TestRegistry,
  merged: TestOptions,
  fn: EachFn<EachValue>,
  base: CollectorBase,
): TestRegistration => ({
  ...chainOptionsOf(registry, merged),
  each: true,
  tags: tagsForChain(registry, registry.frames.current, tagsOf(merged.tags)),
  fixtures: base.fixtures,
  fixtureNames: fixtureNamesOf(fn),
})

const forRowsRegistrationOf = (
  registry: TestRegistry,
  merged: TestOptions,
  fn: ForFn<EachValue>,
  base: CollectorBase,
): TestRegistration => ({
  ...chainOptionsOf(registry, merged),
  each: true,
  fixtures: base.fixtures,
  fixtureNames: fixtureNamesOf(fn),
})

const bindEachOf = (registry: TestRegistry, base: CollectorBase, flags: TestOptions): EachApi => {
  const merged: TestOptions = { ...base.flags, ...flags }
  const mode = modeOf(merged, true)
  return eachApiOf(
    (cases) => (name, fn) => {
      for (const [index, row] of cases.entries()) {
        registry.registerTest(
          formatEachName(name, eachValueOf(row), { index }),
          registry.frames.current,
          mode,
          base.inverted,
          () => fn(...argsOfRow(row)),
          eachRowsRegistrationOf(registry, merged, fn, base),
        )
      }
    },
  )
}

const bindForOf = (registry: TestRegistry, base: CollectorBase, flags: TestOptions): ForApi => {
  const merged: TestOptions = { ...base.flags, ...flags }
  const mode = modeOf(merged, true)
  return forApiOf(
    (cases) => (name, fn) => {
      for (const [index, row] of cases.entries()) {
        registry.registerTest(
          formatEachName(name, eachValueOf(row), { index }),
          registry.frames.current,
          mode,
          base.inverted,
          (context) => fn(row, context),
          forRowsRegistrationOf(registry, merged, fn, base),
        )
      }
    },
  )
}

const SINGLE_CLEANUP_MESSAGE =
  'onCleanup can only be called once per fixture. Define separate fixtures if you need multiple cleanup functions.'

const wrapBuilderFunction = (builder: BuilderFunction): FixtureFunction => {
  const wrapped = (context: object, use: FixtureUse): FixtureValue => {
    let cleanup: (() => void | Promise<void>) | undefined
    const registrar: BuilderFunctionContext = Object.assign(
      (): Promise<void> => {
        throw new TypeError(
          'Builder fixtures receive { onCleanup } as their second argument. Return the fixture value instead of calling use.',
        )
      },
      {
        onCleanup: (fn: () => void | Promise<void>): void => {
          if (cleanup !== undefined) {
            throw new Error(SINGLE_CLEANUP_MESSAGE)
          }
          cleanup = fn
        },
      },
    )
    return Promise.resolve()
      .then(() => builder(context, registrar))
      .then((value) => {
        if (value === undefined) {
          return use(undefined)
        }
        return use(value)
      })
      .then(() => (cleanup === undefined ? undefined : cleanup()))
      .then(() => undefined)
  }
  Object.defineProperty(wrapped, 'toString', { value: () => builder.toString(), enumerable: false })
  return wrapped
}

type BuilderTableArgument = FixtureTableValue | FixtureFunction | FixtureOptions | undefined

const builderValueOf = (value: FixtureTableValue | FixtureFunction | undefined): FixtureTableValue => {
  if (isBuilderFunction(value)) {
    return wrapBuilderFunction(value)
  }
  return value
}

const isBuilderFunction = (value: FixtureTableValue | FixtureFunction | undefined): value is BuilderFunction =>
  typeof value === 'function'

const builderOptionsOf = (options: BuilderFixtureOptions): FixtureOptions =>
  typeof options === 'string' ? { scope: options } : options

const SCOPE_NAMES: ReadonlyArray<string> = ['test', 'file', 'worker']

const isScopeName = (
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): value is BuilderScopeName => typeof value === 'string' && SCOPE_NAMES.includes(value)

const isOptionsObject = (
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): value is FixtureOptions => isObjectLike(value) && !Array.isArray(value)

const isBuilderOptions = (
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): value is BuilderFixtureOptions => typeof value === 'string' || isOptionsObject(value)

const EMPTY_FIXTURE_OPTIONS: FixtureOptions = {}

const builderOptionsArgument = (
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): BuilderFixtureOptions => isBuilderOptions(value) ? value : EMPTY_FIXTURE_OPTIONS

const scopeOrOptionsOf = (
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): FixtureOptions => isBuilderOptions(value) ? builderOptionsOf(value) : EMPTY_FIXTURE_OPTIONS

const builderScopeEntryOf = (name: string, scope: BuilderScopeName): FixtureTable => ({
  [name]: [undefined, { scope }],
})

const builderOptionsEntryOf = (name: string, options: FixtureOptions): FixtureTable => ({
  [name]: [undefined, options],
})

const builderValueEntryOf = (name: string, value: FixtureTableValue | FixtureFunction | undefined): FixtureTable => ({
  [name]: builderValueOf(value),
})

const builderNonScopeEntryOf = (
  name: string,
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): FixtureTable => isOptionsObject(value) ? builderOptionsEntryOf(name, value) : builderValueEntryOf(name, value)

const builderScopeOrValueEntryOf = (
  name: string,
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): FixtureTable => (isScopeName(value) ? builderScopeEntryOf(name, value) : builderNonScopeEntryOf(name, value))

const builderEntryTableOf = (
  name: string,
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
  options: FixtureTableValue | FixtureFunction | undefined,
): FixtureTable =>
  options === undefined
    ? builderScopeOrValueEntryOf(name, value)
    : {
      [name]: [builderValueOf(options), builderOptionsOf(builderOptionsArgument(value))],
    }

const builderTableOf = (
  first: FixtureTable | string,
  second: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
  third: FixtureTableValue | FixtureFunction | undefined,
): FixtureTable => (typeof first !== 'string' ? first : builderEntryTableOf(first, second, third))

const isRootFrame = (registry: TestRegistry): boolean => registry.frames.current.length === 0

const innermostSuiteOf = (registry: TestRegistry): RegisteredSuite | undefined => {
  const innermost = registry.frames.current.at(-1)
  return innermost === undefined ? undefined : registry.suites.get(innermost)
}

const innermostHostOf = (registry: TestRegistry): FixtureHost | undefined => {
  const suite = innermostSuiteOf(registry)
  return suite === undefined ? undefined : suite.view
}

const fixturesOf = (base: CollectorBase): FixtureRegistry => base.fixtures ?? createFixtureRegistry()

const extendApiOf =
  (registry: TestRegistry, base: CollectorBase): BuilderExtendApi & BuilderScopedApi =>
  (first: FixtureTable | string, second?: BuilderTableArgument, third?: FixtureTableValue | FixtureFunction) => {
    const extended = extendFixtures(fixturesOf(base), builderTableOf(first, second, third), isRootFrame(registry))
    if (Result.isFailure(extended)) {
      throw new Error(extended.failure.join('\n'))
    }
    return collectedApiOf(registry, { ...base, fixtures: extended.success })
  }

const overrideApiOf =
  (registry: TestRegistry, base: CollectorBase): BuilderOverrideApi =>
  (first: FixtureTable | string, second?: BuilderTableArgument, third?: FixtureTableValue | FixtureFunction) => {
    const overridden = overrideFixtures(
      fixturesOf(base),
      innermostHostOf(registry),
      builderTableOf(first, second, third),
      isRootFrame(registry),
    )
    if (Result.isFailure(overridden)) {
      throw new Error(overridden.failure.join('\n'))
    }
    return collectedApiOf(registry, base)
  }

const isFunctionOrUndefined = (value: BuilderTableArgument): boolean =>
  typeof value === 'function' || value === undefined

const scopedTwoArgumentOf = (chained: RegistryTestApi, name: string, second: BuilderTableArgument): RegistryTestApi =>
  second === undefined ? chained.override({ [name]: undefined }) : chained.override(name, second)

const scopedThreeArgumentOf = (
  chained: RegistryTestApi,
  name: string,
  second: BuilderTableArgument,
  third: FixtureTableValue | FixtureFunction,
): RegistryTestApi =>
  isFunctionOrUndefined(second)
    ? chained.override(name, third)
    : chained.override(name, scopeOrOptionsOf(second), third)

const namedScopedOf = (
  chained: RegistryTestApi,
  name: string,
  second: BuilderTableArgument,
  third: FixtureTableValue | FixtureFunction | undefined,
): RegistryTestApi =>
  third === undefined
    ? scopedTwoArgumentOf(chained, name, second)
    : scopedThreeArgumentOf(chained, name, second, third)

const scopedApiOf =
  (registry: TestRegistry, base: CollectorBase): BuilderOverrideApi =>
  (first: FixtureTable | string, second?: BuilderTableArgument, third?: FixtureTableValue | FixtureFunction) => {
    const chained = collectedApiOf(registry, base)
    return typeof first === 'string' ? namedScopedOf(chained, first, second, third) : chained.override(first)
  }

const todoApiOf = (registry: TestRegistry, base: CollectorBase): (name: string) => void => (name: string): void => {
  registry.registerTest(name, registry.frames.current, 'todo', false, undefined, {
    timeout: undefined,
    retry: undefined,
    repeats: undefined,
    concurrent: false,
    each: false,
    fixtures: base.fixtures,
  })
}

const hookTargetOf = (registry: TestRegistry, innermost: number | undefined): HookSets | undefined =>
  innermost === undefined ? registry.rootHooksFor(registry.files.current) : registry.suiteHooks.get(innermost)

const hookAt = (registry: TestRegistry, kind: HookKind, hook: HarnessHookFunction, timeout?: number): void => {
  const target = hookTargetOf(registry, registry.frames.current.at(-1))
  if (target !== undefined) {
    target[kind].push({ fn: hook, timeout })
  }
}

const aroundTargetOf = (registry: TestRegistry, innermost: number | undefined): AroundSets | undefined =>
  innermost === undefined ? registry.rootAroundFor(registry.files.current) : registry.suiteAround.get(innermost)

const aroundAt = (registry: TestRegistry, kind: AroundKind, hook: AroundHookFunction, timeout?: number): void => {
  const target = aroundTargetOf(registry, registry.frames.current.at(-1))
  if (target !== undefined) {
    target[kind].push({ hook, timeout })
  }
}

const hookBinderOf =
  (registry: TestRegistry, kind: HookKind): HookApi['beforeEach'] =>
  (hook: HarnessHookFunction, timeout?: number): void => hookAt(registry, kind, hook, timeout)

const aroundBinderOf =
  (registry: TestRegistry, kind: AroundKind): HookApi['aroundEach'] =>
  (hook: AroundHookFunction, timeout?: number): void => aroundAt(registry, kind, hook, timeout)

const isRunningTestContext = (context: HarnessTestContext): context is TestContext => typeof context === 'function'

const runningTestContextOf = (context: HarnessTestContext): TestContext => {
  if (isRunningTestContext(context)) {
    return context
  }
  throw new Error('onTestFinished must be called while a test is running')
}

const currentTestOf = (registry: TestRegistry): TestContext => {
  const context = registry.currentTest
  if (context === undefined) {
    throw new Error('onTestFinished must be called while a test is running')
  }
  return runningTestContextOf(context)
}

interface VariantCall {
  (name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  (name: string, options: TestOptions, fn: TestFunctionWithTimeout): void
}

interface SuiteCall {
  (name: string, body: SuiteBody): void
  (name: string, options: SuiteOptions, body: SuiteBody): void
}

interface ChainableGetters {
  readonly each: () => EachApi
  readonly for: () => ForApi
  readonly concurrent: () => ChainableVariantApi
  readonly skipIf: () => (condition: boolean) => RegistryTestApi
  readonly runIf: () => (condition: boolean) => RegistryTestApi
}

const CHAINABLE_LAZY_GETTER_NAMES: ReadonlyArray<keyof ChainableGetters> = [
  'each',
  'for',
  'concurrent',
  'skipIf',
  'runIf',
]

const descriptorOf = <A>(get: () => A): PropertyDescriptor => ({ get, enumerable: true })

const lazyPropDescriptors = <Names extends string>(
  names: ReadonlyArray<Names>,
  getters: Record<Names, () => object>,
): PropertyDescriptorMap =>
  Object.fromEntries(names.map((name): [string, PropertyDescriptor] => [name, descriptorOf(getters[name])]))

const valuePropDescriptors = <Names extends string>(
  names: ReadonlyArray<Names>,
  values: Record<Names, object>,
): PropertyDescriptorMap =>
  Object.fromEntries(
    names.map((name): [string, PropertyDescriptor] => [name, { value: values[name], enumerable: true }]),
  )

const skipFlagOf = (condition: boolean): boolean => condition !== false
const runFlagOf = (condition: boolean): boolean => condition === false

const flaggedApiOf = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
  skipOf: (condition: boolean) => boolean,
): (condition: boolean) => RegistryTestApi =>
(condition: boolean): RegistryTestApi =>
  collectedApiOf(registry, { ...base, flags: { ...base.flags, ...flags, skip: skipOf(condition) } })

const chainableGettersOf = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
): ChainableGetters => {
  const variant = (next: TestOptions): ChainableVariantApi => chainableVariantOf(registry, base, next)
  return {
    each: () => bindEachOf(registry, base, flags),
    for: () => bindForOf(registry, base, flags),
    concurrent: () => variant({ ...flags, concurrent: true }),
    skipIf: () => flaggedApiOf(registry, base, flags, skipFlagOf),
    runIf: () => flaggedApiOf(registry, base, flags, runFlagOf),
  }
}

function withChainableProps(bound: VariantCall, getters: ChainableGetters): ChainableVariantApi {
  assertChainableProps(bound, getters)
  return bound
}

function assertChainableProps(bound: VariantCall, getters: ChainableGetters): asserts bound is ChainableVariantApi {
  Object.defineProperties(bound, lazyPropDescriptors(CHAINABLE_LAZY_GETTER_NAMES, getters))
}

const chainableVariantOf = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
): ChainableVariantApi => {
  function bound(name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  function bound(name: string, options: TestOptions, fn: TestFunctionWithTimeout): void
  function bound(
    name: string,
    fnOrOptions?: TestFunctionWithTimeout | TestOptions,
    maybeFn?: TestFunctionWithTimeout | number,
  ): void {
    registerCollected(registry, base, flags, name, fnOrOptions, maybeFn)
  }
  return withChainableProps(bound, chainableGettersOf(registry, base, flags))
}

type TestApiProps = Pick<RegistryTestApi, keyof RegistryTestApi>

type TestApiGetterName = 'skip' | 'only' | 'fails' | 'each' | 'for' | 'concurrent' | 'skipIf' | 'runIf'

type TestApiValueName = Exclude<keyof TestApiProps, TestApiGetterName>

type TestApiGetters = { readonly [K in TestApiGetterName]: () => TestApiProps[K] }

type TestApiValues = { readonly [K in TestApiValueName]: TestApiProps[K] }

const TEST_API_LAZY_GETTER_NAMES: ReadonlyArray<TestApiGetterName> = [
  'skip',
  'only',
  'fails',
  'each',
  'for',
  'concurrent',
  'skipIf',
  'runIf',
]

const TEST_API_VALUE_NAMES: ReadonlyArray<TestApiValueName> = [
  'todo',
  'extend',
  'override',
  'scoped',
  'describe',
  'suite',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'aroundEach',
  'aroundAll',
]

const testApiGettersOf = (registry: TestRegistry, base: CollectorBase): TestApiGetters => {
  const variant = (flags: TestOptions): ChainableVariantApi => chainableVariantOf(registry, base, flags)
  const root = variant({})
  return {
    skip: () => variant({ skip: true }),
    only: () => variant({ only: true }),
    fails: () => variant({ fails: true }),
    each: () => bindEachOf(registry, base, {}),
    for: () => bindForOf(registry, base, {}),
    concurrent: () => variant({ concurrent: true }),
    skipIf: () => root.skipIf,
    runIf: () => root.runIf,
  }
}

const testApiValuesOf = (registry: TestRegistry, base: CollectorBase): TestApiValues => ({
  todo: todoApiOf(registry, base),
  extend: extendApiOf(registry, base),
  override: overrideApiOf(registry, base),
  scoped: scopedApiOf(registry, base),
  describe: createDescribe(registry),
  suite: createDescribe(registry),
  beforeEach: hookBinderOf(registry, 'beforeEach'),
  afterEach: hookBinderOf(registry, 'afterEach'),
  beforeAll: hookBinderOf(registry, 'beforeAll'),
  afterAll: hookBinderOf(registry, 'afterAll'),
  aroundEach: aroundBinderOf(registry, 'aroundEach'),
  aroundAll: aroundBinderOf(registry, 'aroundAll'),
})

function withTestApiProps(api: VariantCall, registry: TestRegistry, base: CollectorBase): RegistryTestApi {
  assertTestApiProps(api, registry, base)
  return api
}

function assertTestApiProps(
  api: VariantCall,
  registry: TestRegistry,
  base: CollectorBase,
): asserts api is RegistryTestApi {
  Object.defineProperties(api, {
    ...lazyPropDescriptors(TEST_API_LAZY_GETTER_NAMES, testApiGettersOf(registry, base)),
    ...valuePropDescriptors(TEST_API_VALUE_NAMES, testApiValuesOf(registry, base)),
  })
}

const collectedApiOf = (registry: TestRegistry, base: CollectorBase): RegistryTestApi => {
  function api(
    name: string,
    fnOrOptions?: TestFunctionWithTimeout | TestOptions,
    maybeFn?: TestFunctionWithTimeout | number,
  ): void {
    registerCollected(registry, base, {}, name, fnOrOptions, maybeFn)
  }
  return withTestApiProps(api, registry, base)
}

export const createIt = (registry: TestRegistry): RegistryTestApi =>
  collectedApiOf(registry, { inverted: false, flags: {}, fixtures: undefined })

const openWithArgsOf = (
  registry: TestRegistry,
  open: OpenSuite,
  name: string,
  mode: TestMode,
  concurrent: boolean,
  chainShuffle: boolean | undefined,
  options: SuiteOptions | SuiteBody,
  body: SuiteBody | undefined,
): void => {
  const resolvedBody = resolvedSuiteBodyOf(options, body)
  if (resolvedBody === undefined) {
    throw new TypeError('Suite body must be a function')
  }
  open(name, mode, suiteRegistrationOf(options, concurrent, chainShuffle), resolvedBody)
}

type OpenSuite = (
  name: string,
  mode: TestMode,
  registration: SuiteRegistration,
  invoke: (api: RegistryTestApi) => void,
) => void

const resolvedSuiteBodyOf = (options: SuiteOptions | SuiteBody, body: SuiteBody | undefined): SuiteBody | undefined =>
  typeof options === 'function' ? options : body

const suiteOptionsOf = (options: SuiteOptions | SuiteBody): SuiteOptions => typeof options === 'function' ? {} : options

const suiteShuffleOf = (options: SuiteOptions | SuiteBody, chainShuffle: boolean | undefined): boolean | undefined =>
  suiteOptionsOf(options).shuffle ?? chainShuffle

const suiteRegistrationOf = (
  options: SuiteOptions | SuiteBody,
  concurrent: boolean,
  chainShuffle: boolean | undefined,
): SuiteRegistration => ({
  concurrent,
  shuffle: suiteShuffleOf(options, chainShuffle),
  timeout: suiteOptionsOf(options).timeout,
  retry: suiteOptionsOf(options).retry,
  repeats: suiteOptionsOf(options).repeats,
})

const suiteEachBinderOf = (
  registry: TestRegistry,
  open: OpenSuite,
  mode: TestMode,
  concurrent: boolean,
  shuffle: boolean | undefined,
): RowsBinder<EachSuiteBody<EachValue>> =>
(cases) =>
(name, body) => {
  for (const [index, row] of cases.entries()) {
    open(
      formatEachName(name, eachValueOf(row), { index }),
      mode,
      { concurrent, shuffle },
      (_api) => body(...argsOfRow(row)),
    )
  }
}

const suiteForBinderOf = (
  registry: TestRegistry,
  open: OpenSuite,
  mode: TestMode,
  concurrent: boolean,
  shuffle: boolean | undefined,
): RowsBinder<ForSuiteBody<EachValue>> =>
(cases) =>
(name, body) => {
  for (const [index, row] of cases.entries()) {
    open(formatEachName(name, eachValueOf(row), { index }), mode, { concurrent, shuffle }, () => body(row))
  }
}

const suiteVariantOf = (
  registry: TestRegistry,
  open: OpenSuite,
  mode: TestMode,
  concurrent: boolean,
  shuffle?: boolean,
): SuiteVariants => {
  function callable(name: string, body: SuiteBody): void
  function callable(name: string, options: SuiteOptions, body: SuiteBody): void
  function callable(name: string, optionsOrBody: SuiteOptions | SuiteBody, maybeBody?: SuiteBody): void {
    openWithArgsOf(registry, open, name, mode, concurrent, shuffle, optionsOrBody, maybeBody)
  }
  return Object.assign(callable, {
    each: suiteEachApiOf(suiteEachBinderOf(registry, open, mode, concurrent, shuffle)),
    for: suiteForApiOf(suiteForBinderOf(registry, open, mode, concurrent, shuffle)),
  })
}

type SuiteApiProps = Omit<RegistrySuiteApi, 'skipIf' | 'runIf'> & {
  readonly skipIf: (condition: boolean) => SuiteVariants
  readonly runIf: (condition: boolean) => SuiteVariants
}

const skipIfVariantOf = (
  registry: TestRegistry,
  open: OpenSuite,
  concurrent: boolean,
  condition: boolean,
): SuiteVariants =>
  condition
    ? suiteVariantOf(registry, open, 'skip', concurrent)
    : suiteApiOf(registry, open, concurrent)

const runIfVariantOf = (
  registry: TestRegistry,
  open: OpenSuite,
  concurrent: boolean,
  condition: boolean,
): SuiteVariants =>
  condition
    ? suiteApiOf(registry, open, concurrent)
    : suiteVariantOf(registry, open, 'skip', concurrent)

const suiteApiPropsOf = (
  registry: TestRegistry,
  open: OpenSuite,
  concurrent: boolean,
): SuiteApiProps => ({
  skip: suiteVariantOf(registry, open, 'skip', concurrent),
  only: suiteVariantOf(registry, open, 'only', concurrent),
  todo: (name: string) => open(name, 'todo', { concurrent }, () => {}),
  each: suiteVariantOf(registry, open, 'run', concurrent).each,
  for: suiteVariantOf(registry, open, 'run', concurrent).for,
  concurrent: suiteVariantOf(registry, open, 'run', true),
  shuffle: suiteVariantOf(registry, open, 'run', concurrent, true),
  skipIf: (condition: boolean) => skipIfVariantOf(registry, open, concurrent, condition),
  runIf: (condition: boolean) => runIfVariantOf(registry, open, concurrent, condition),
})

function withSuiteApiProps(callable: SuiteCall, props: SuiteApiProps): RegistrySuiteApi {
  assertSuiteApiProps(callable, props)
  return callable
}

function assertSuiteApiProps(callable: SuiteCall, props: SuiteApiProps): asserts callable is RegistrySuiteApi {
  Object.assign(callable, props)
}

const suiteApiOf = (
  registry: TestRegistry,
  open: OpenSuite,
  concurrent: boolean,
  chainShuffle?: boolean,
): RegistrySuiteApi => {
  function callable(name: string, body: SuiteBody): void
  function callable(name: string, options: SuiteOptions, body: SuiteBody): void
  function callable(name: string, optionsOrBody: SuiteOptions | SuiteBody, maybeBody?: SuiteBody): void {
    openWithArgsOf(registry, open, name, 'run', concurrent, chainShuffle, optionsOrBody, maybeBody)
  }
  return withSuiteApiProps(callable, suiteApiPropsOf(registry, open, concurrent))
}

export const createDescribe = (registry: TestRegistry): RegistrySuiteApi => {
  const open: OpenSuite = (name, mode, registration, invoke): void => {
    const previous = registry.frames.current
    const suite = registry.registerSuite(name, previous, mode, registration)
    registry.frames.current = [...previous, suite.id]
    try {
      invoke(createIt(registry))
    } finally {
      registry.frames.current = previous
    }
  }
  return suiteApiOf(registry, open, false)
}

export const createHarnessApi = (registry: TestRegistry): HarnessApi => {
  const it = createIt(registry)
  const describe = createDescribe(registry)
  const hookApi: HookApi = {
    beforeAll: (hook, timeout) => hookAt(registry, 'beforeAll', hook, timeout),
    afterAll: (hook, timeout) => hookAt(registry, 'afterAll', hook, timeout),
    beforeEach: (hook, timeout) => hookAt(registry, 'beforeEach', hook, timeout),
    afterEach: (hook, timeout) => hookAt(registry, 'afterEach', hook, timeout),
    aroundEach: (hook, timeout) => aroundAt(registry, 'aroundEach', hook, timeout),
    aroundAll: (hook, timeout) => aroundAt(registry, 'aroundAll', hook, timeout),
    onTestFinished: (finalizer, timeout) => {
      currentTestOf(registry).onTestFinished(finalizer, timeout)
    },
    onTestFailed: (handler, timeout) => {
      currentTestOf(registry).onTestFailed(handler, timeout)
    },
  }
  return {
    describe,
    suite: describe,
    it,
    test: it,
    hooks: hookApi,
    beforeAll: hookApi.beforeAll,
    afterAll: hookApi.afterAll,
    beforeEach: hookApi.beforeEach,
    afterEach: hookApi.afterEach,
    aroundEach: hookApi.aroundEach,
    aroundAll: hookApi.aroundAll,
    onTestFinished: hookApi.onTestFinished,
    onTestFailed: hookApi.onTestFailed,
    inject: (name: string) => registry.provided.current[name],
  }
}

const createVariantApiDataFirst = (
  registry: TestRegistry,
  mode: TestMode,
  inverted: boolean,
): VariantApi => {
  function variant(name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  function variant(name: string, options: TestOptions, fn: TestFunctionWithTimeout): void
  function variant(
    name: string,
    fnOrOptions?: TestFunctionWithTimeout | TestOptions,
    maybeFn?: TestFunctionWithTimeout | number,
  ): void {
    registry.registerTest(name, registry.frames.current, mode, inverted, parseTestArguments(fnOrOptions, maybeFn).fn)
  }
  return Object.assign(variant, {
    each: eachApiOf(chainRowsBinderOf(registry, mode, inverted)),
    for: bindForOf(registry, { inverted, flags: {}, fixtures: undefined }, {}),
  })
}

export const createVariantApi: {
  (registry: TestRegistry, mode: TestMode, inverted: boolean): VariantApi
  (mode: TestMode, inverted: boolean): (registry: TestRegistry) => VariantApi
} = dual((args: IArguments): boolean => args.length >= 3, createVariantApiDataFirst)

const chainRowsBinderOf = (
  registry: TestRegistry,
  mode: TestMode,
  inverted: boolean,
): RowsBinder<EachFn<EachValue>> =>
(cases) =>
(name, fn) => {
  for (const [index, row] of cases.entries()) {
    const chain = suiteChainOf(registry)
    registry.registerTest(
      formatEachName(name, eachValueOf(row), { index }),
      registry.frames.current,
      mode,
      inverted,
      () => fn(...argsOfRow(row)),
      {
        timeout: inheritedOf(chain, suiteTimeoutOf),
        retry: inheritedOf(chain, suiteRetryOf),
        repeats: inheritedOf(chain, suiteRepeatsOf),
        concurrent: chain.some(isConcurrentSuite),
        shuffle: chain.some(isShuffledSuite),
        each: true,
        fixtures: undefined,
      },
    )
  }
}

/**
 * `test.each` / `describe.each` title formatting, ported from Vitest 5.0.1's
 * `formatTitle` (dist/chunks/run.*.js) together with the token formatter it
 * delegates to (`@vitest/utils/display`'s `format`), so a table row produces
 * the exact name Vitest generates for it.
 *
 * Faithful pieces: the `%[sdjifoOc%]` token set, where every matched token
 * consumes one row item — `%%` consumes too and renders `%` followed by the
 * item it consumed, `%c` consumes and renders nothing; the `%#`/`%$` pre-pass
 * (0-based `%#`, 1-based `%$`, `%%` escaped around it); the `%f` pre-pass that
 * renders negative NaN and negative zero as `-%f`; the `%`-character-count
 * guard (`consumed < count`), so a token the row cannot feed formats
 * `undefined` while a token past that count stays literal; `%d`/`%i`/`%f`
 * coercion through `Number`/`Number.parseInt(String(...))`; `%j` rendering
 * `undefined` for a value JSON cannot represent; and the `$`-attribute rules
 * (object attributes read the first row item, numeric keys read the row list,
 * `$name` on a non-object row stays literal, and a string value is truncated
 * rather than quoted).
 *
 * Object/array/non-primitive values render with Vitest's own display formatter
 * (`@vitest/utils/display`, resolved from the user's vitest install, 40-character
 * budget by default); that formatter stays injectable, and the fallback when the
 * module cannot be resolved is JSON.
 */

export const DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE = 40

interface VitestDisplay {
  readonly inspect: (value: EachValue, options?: { truncate?: number }) => string
}

const DISPLAY_SPECIFIER = '@vitest/utils/display'

interface InspectCarrier {
  readonly inspect: EachValue
}

interface ModuleLoader {
  (specifier: string): object | undefined
  resolve(specifier: string): string
}

const moduleLoaderFrom = (from: string): ModuleLoader => createRequire(from)

const isInspectCarrier = (loaded: object | null | undefined): loaded is InspectCarrier =>
  isObjectLike(loaded) && 'inspect' in loaded

const isInspectFunction = (value: EachValue): value is VitestDisplay['inspect'] => typeof value === 'function'

const inspectDisplayOf = (inspect: EachValue): VitestDisplay | undefined =>
  isInspectFunction(inspect) ? { inspect } : undefined

const displayOfModule = (loaded: object | undefined): VitestDisplay | undefined =>
  isInspectCarrier(loaded) ? inspectDisplayOf(loaded.inspect) : undefined

const loadDisplayModule = (): object | undefined => {
  const loader = moduleLoaderFrom(import.meta.url)
  const vitestPackageJson = loader.resolve('vitest/package.json')
  return moduleLoaderFrom(vitestPackageJson)(DISPLAY_SPECIFIER)
}

const resolveDisplay = (): VitestDisplay | undefined => {
  try {
    return displayOfModule(loadDisplayModule())
  } catch {
    return undefined
  }
}

let resolvedDisplay: VitestDisplay | undefined
let displayResolved = false

const displayOf = (): VitestDisplay | undefined => {
  if (!displayResolved) {
    displayResolved = true
    resolvedDisplay = resolveDisplay()
  }
  return resolvedDisplay
}

const FORMAT_TOKENS = /%[sdjifoOc%]/g
const ATTRIBUTE_TOKENS = /\$([$\p{ID_Continue}.]+)/gu
const ESCAPED_PERCENT = '__vitest_escaped_%__'

const isNegativeZero = (value: EachValue): boolean => isZeroNumber(value) && 1 / value < 0

const isZeroNumber = (value: EachValue): value is number => typeof value === 'number' && value === 0

const jsonObjectTextOf = (value: object): string => String(JSON.stringify(value))

const jsonFormatValue: EachValueFormatter = (value) =>
  Match.value(value).pipe(
    Match.when(Match.bigint, (bigintValue): string => `${bigintValue.toString()}n`),
    Match.when(isNegativeZero, (): string => '-0'),
    Match.when(Match.symbol, (symbolValue): string => symbolValue.toString()),
    Match.when(Match.string, (stringValue): string => stringValue),
    Match.when(isTextScalar, (scalar): string => scalarTextOf(scalar)),
    Match.orElse(jsonObjectTextOf),
  )

const truncatedOf = (truncate?: number): number => truncate ?? DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE

const inspectValueOf = (display: VitestDisplay, value: EachValue, truncate: number): string =>
  display.inspect(value, { truncate })

const defaultFormatValue = (value: EachValue, truncate?: number): string => {
  const display = displayOf()
  if (display === undefined) {
    return jsonFormatValue(value)
  }
  return inspectValueOf(display, value, truncatedOf(truncate))
}

const propertyOf = (source: EachValue, key: string): EachValue => {
  if (!isObjectLike(source)) {
    return undefined
  }
  return source[key]
}

const walkSegments = (source: EachValue, segments: ReadonlyArray<string>): EachValue => {
  let result: EachValue = source
  for (const segment of segments) {
    result = propertyOf(result, segment)
  }
  return result
}

const objectAttr = (source: EachValue, path: string, fallback: EachValue): EachValue => {
  const walked = walkSegments(source, path.replace(/\[(\d+)\]/g, '.$1').split('.'))
  return walked === undefined ? fallback : walked
}

const NAN_SIGN_BUFFER = new ArrayBuffer(8)

const isNaNNumber = (value: EachValue): value is number => typeof value === 'number' && Number.isNaN(value)

const nanHighWordOf = (): number => new Uint32Array(NAN_SIGN_BUFFER).at(1) ?? 0

const isNegativeNaN = (value: EachValue): boolean => {
  if (!isNaNNumber(value)) {
    return false
  }
  const f64 = new Float64Array(NAN_SIGN_BUFFER)
  f64[0] = value
  return nanHighWordOf() >>> 31 === 1
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

const surrogateAdjustedEnd = (value: string, end: number): number =>
  isHighSurrogate(value.charCodeAt(end - 1)) ? end - 1 : end

const truncateString = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, surrogateAdjustedEnd(value, maxLength - 1))}…`
}

const floatOccurrencesOf = (template: string): ReadonlyArray<string> => template.match(/%f/g) ?? []

const signedOccurrenceOf = (template: string, at: number): string => {
  let occurrence = 0
  return template.replace(/%f/g, (match) => {
    occurrence += 1
    return occurrence === at + 1 ? `-${match}` : match
  })
}

const hasNegativeSignValue = (value: EachValue): boolean => isNegativeNaN(value) || isNegativeZero(value)

const signedIfNegativeOf = (template: string, value: EachValue, at: number): string =>
  hasNegativeSignValue(value) ? signedOccurrenceOf(template, at) : template

const signedFloatTemplate = (template: string, items: readonly EachValue[]): string => {
  let signed = template
  for (const at of floatOccurrencesOf(template).keys()) {
    signed = signedIfNegativeOf(signed, items[at], at)
  }
  return signed
}

const scalarTextOf = (value: TextScalar): string =>
  Match.value(value).pipe(
    Match.when(Match.null, (): string => 'null'),
    Match.when(Match.undefined, (): string => 'undefined'),
    Match.when(Match.string, (stringValue): string => stringValue),
    Match.when(Match.number, (numberValue): string => numberValue.toString()),
    Match.when(Match.boolean, (booleanValue): string => booleanValue.toString()),
    Match.when(Match.bigint, (bigintValue): string => bigintValue.toString()),
    Match.when(Match.symbol, (symbolValue): string => symbolValue.toString()),
    Match.orElse(textMethodOf),
  )

const textMethodOf = (value: TextCoercible): string => value.toString()

const escapedPercentTailOf = (value: EachValue, formatValue: EachValueFormatter): string =>
  Match.value(value).pipe(
    Match.when(isTextScalar, (scalar): string => ` ${scalarTextOf(scalar)}`),
    Match.orElse((objectValue: object): string => ` ${formatValue(objectValue)}`),
  )

const hasMethodNamed = (value: object, name: string): boolean => typeof Reflect.get(value, name) === 'function'

const hasToStringOrValueOf = (value: object): boolean =>
  hasMethodNamed(value, 'toString') || hasMethodNamed(value, 'valueOf')

const hasPrimitiveCoercion = (value: object): boolean => Symbol.toPrimitive in value || hasToStringOrValueOf(value)

const isStringCoercibleObject = (value: EachValue): value is TextCoercible =>
  isObjectLike(value) && hasPrimitiveCoercion(value)

const NUMERIC_TEXT_TYPEOF: Record<string, true> = {
  number: true,
  boolean: true,
  bigint: true,
  undefined: true,
}

const isNumericTextField = (value: EachValue): value is number | boolean | bigint | undefined =>
  NUMERIC_TEXT_TYPEOF[typeof value] === true

const coercibleTextOf = (value: TextCoercible): string => String(value)

const numericTextOf = (value: EachValue): string =>
  Match.value(value).pipe(
    Match.when(Match.string, (text): string => text),
    Match.when(isNumericTextField, (text): string => String(text)),
    Match.when(Match.null, (): string => 'null'),
    Match.when(Match.symbol, (symbolValue): string => symbolValue.toString()),
    Match.when(isStringCoercibleObject, (coercible): string => coercibleTextOf(coercible)),
    Match.orElse(() => {
      throw new TypeError('Cannot convert object to primitive value')
    }),
  )

const isToStringObject = (value: EachValue): value is TextCoercible =>
  isObjectLike(value) && hasMethodNamed(value, 'toString')

const isCustomToString = (value: TextCoercible): boolean => value.toString !== Object.prototype.toString

const customStringOf = (value: TextCoercible, formatValue: EachValueFormatter): string =>
  isCustomToString(value) ? value.toString() : formatValue(value)

const objectStringTokenOf = (value: object, formatValue: EachValueFormatter): string =>
  isToStringObject(value) ? customStringOf(value, formatValue) : formatValue(value)

const stringTokenOf = (value: EachValue, formatValue: EachValueFormatter): string =>
  Match.value(value).pipe(
    Match.when(Match.bigint, (bigintValue): string => `${bigintValue.toString()}n`),
    Match.when(isNegativeZero, (): string => '-0'),
    Match.when(isTextScalar, (scalar): string => scalarTextOf(scalar)),
    Match.orElse((objectValue: object): string => objectStringTokenOf(objectValue, formatValue)),
  )

const decimalTokenOf = (value: EachValue): string =>
  Match.value(value).pipe(
    Match.when(Match.bigint, (bigintValue): string => `${bigintValue}n`),
    Match.when(Match.symbol, (): string => 'NaN'),
    Match.orElse((other): string => Number(other).toString()),
  )

const integerTokenOf = (value: EachValue): string =>
  Match.value(value).pipe(
    Match.when(Match.bigint, (bigintValue): string => `${bigintValue.toString()}n`),
    Match.orElse((other): string => Number.parseInt(numericTextOf(other)).toString()),
  )

const floatTokenOf = (value: EachValue): string => Number.parseFloat(numericTextOf(value)).toString()

const CIRCULAR_TITLE_TEXT = '[Circular]'

const isCircularMessage = (error: Error): boolean =>
  error.message.includes('circular structure') || error.message.includes('cyclic')

const isCircularFailure = (error: unknown): error is Error => error instanceof Error && isCircularMessage(error)

const jsonTokenOf = (value: EachValue): string => {
  try {
    return String(JSON.stringify(value))
  } catch (error) {
    return Match.value(error).pipe(
      Match.when(isCircularFailure, (): string => CIRCULAR_TITLE_TEXT),
      Match.orElse((cause): string => {
        throw cause
      }),
    )
  }
}

type TokenFormatter = (value: EachValue, formatValue: EachValueFormatter) => string

const FORMAT_TOKEN_FORMATTERS: Record<string, TokenFormatter> = {
  '%%': (value, formatValue) => `%${escapedPercentTailOf(value, formatValue)}`,
  '%s': (value, formatValue) => stringTokenOf(value, formatValue),
  '%d': (value) => decimalTokenOf(value),
  '%i': (value) => integerTokenOf(value),
  '%f': (value) => floatTokenOf(value),
  '%o': (value, formatValue) => formatValue(value),
  '%O': (value, formatValue) => formatValue(value),
  '%c': () => '',
  '%j': (value) => jsonTokenOf(value),
}

const formatTokenPair = (token: string, value: EachValue, formatValue: EachValueFormatter): string => {
  const formatter = FORMAT_TOKEN_FORMATTERS[token]
  return formatter === undefined ? token : formatter(value, formatValue)
}

const attributeValueOf = (items: readonly EachValue[], key: string): EachValue => {
  const arrayElement = numericAttributeOf(items, key)
  if (isObjectValue(items[0])) {
    return objectAttr(items[0], key, arrayElement)
  }
  return arrayElement
}

const numericAttributeOf = (items: readonly EachValue[], key: string): EachValue | undefined =>
  isArrayKeyOf(key) ? objectAttr(items, key, undefined) : undefined

const isArrayKeyOf = (key: string): boolean => /^\d+$/.test(key)

const isAttributeSource = (items: readonly EachValue[], key: string): boolean =>
  isObjectValue(items[0]) || isArrayKeyOf(key)

const attributeTextOf = (
  items: readonly EachValue[],
  key: string,
  formatValue: EachValueFormatter,
  truncate: number,
): string | undefined =>
  isAttributeSource(items, key)
    ? formatAttributeValue(attributeValueOf(items, key), formatValue, truncate)
    : undefined

const formatAttributeValue = (value: EachValue, formatValue: EachValueFormatter, truncate: number): string =>
  typeof value === 'string' ? truncateString(value, truncate) : formatValue(value)

const substituteAttributes = (
  segment: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
): string =>
  segment.replace(ATTRIBUTE_TOKENS, (match, key: string) => attributeTextOf(items, key, formatValue, truncate) ?? match)

const itemsOfRow = (row: EachValue): readonly EachValue[] => {
  const items: ReadonlyArray<EachValue> = Array.isArray(row) ? row : [row]
  return items
}

const hasIndexToken = (template: string): boolean => template.includes('%#') || template.includes('%$')

const substituteIndexTokens = (template: string, index: number): string =>
  template
    .replace(/%%/g, ESCAPED_PERCENT)
    .replace(/%#/g, String(index))
    .replace(/%\$/g, String(index + 1))
    .replace(new RegExp(ESCAPED_PERCENT, 'g'), '%%')

const indexedTemplateOf = (template: string, index: number): string =>
  hasIndexToken(template) ? substituteIndexTokens(template, index) : template

const tokenCountOf = (text: string): number => text.split('%').length - 1

const withSignsOf = (indexed: string, items: readonly EachValue[]): string =>
  indexed.includes('%f') ? signedFloatTemplate(indexed, items) : indexed

interface NameFormatState {
  readonly output: string
  readonly cursor: number
  readonly lastIndex: number
}

const initialFormatState: NameFormatState = { output: '', cursor: 0, lastIndex: 0 }

const gapTextOf = (
  start: number,
  at: number,
  text: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
): string => (start < at ? substituteAttributes(text.slice(start, at), items, formatValue, truncate) : '')

const tokenTextOf = (
  cursor: number,
  count: number,
  token: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
): string => (cursor < count ? formatTokenPair(token, items[cursor], formatValue) : token)

const nextCursorOf = (cursor: number, count: number): number => (cursor < count ? cursor + 1 : cursor)

const matchAtOf = (match: RegExpMatchArray): number => match.index ?? 0

const stepFormatState = (
  state: NameFormatState,
  match: RegExpMatchArray,
  text: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
  count: number,
): NameFormatState => {
  const at = matchAtOf(match)
  return {
    output: state.output +
      gapTextOf(state.lastIndex, at, text, items, formatValue, truncate) +
      tokenTextOf(state.cursor, count, match[0], items, formatValue),
    cursor: nextCursorOf(state.cursor, count),
    lastIndex: at + match[0].length,
  }
}

const tailTextOf = (
  state: NameFormatState,
  text: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
): string =>
  state.lastIndex < text.length
    ? substituteAttributes(text.slice(state.lastIndex), items, formatValue, truncate)
    : ''

const formatNameText = (
  text: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
  count: number,
): string => {
  const state = Array.from(text.matchAll(FORMAT_TOKENS)).reduce(
    (current, match) => stepFormatState(current, match, text, items, formatValue, truncate, count),
    initialFormatState,
  )
  return state.output + tailTextOf(state, text, items, formatValue, truncate)
}

const optionsTruncateOf = (options?: EachNameOptions): number =>
  options === undefined ? DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE : truncatedOf(options.truncate)

const indexOrDefault = (index: number | undefined): number => index ?? 0

const optionsIndexOf = (options?: EachNameOptions): number => options === undefined ? 0 : indexOrDefault(options.index)

const formatterForTruncate = (truncate: number): EachValueFormatter => (value) => defaultFormatValue(value, truncate)

const formatValueOrFallback = (
  formatValue: EachValueFormatter | undefined,
  fallback: EachValueFormatter,
): EachValueFormatter => formatValue ?? fallback

const optionsFormatValueOf = (
  options: EachNameOptions | undefined,
  truncate: number,
): EachValueFormatter =>
  options === undefined
    ? formatterForTruncate(truncate)
    : formatValueOrFallback(options.formatValue, formatterForTruncate(truncate))

const formatEachNameDataFirst = (template: string, row: EachValue, options?: EachNameOptions): string => {
  const truncate = optionsTruncateOf(options)
  const items = itemsOfRow(row)
  const indexed = indexedTemplateOf(template, optionsIndexOf(options))
  return formatNameText(
    withSignsOf(indexed, items),
    items,
    optionsFormatValueOf(options, truncate),
    truncate,
    tokenCountOf(indexed),
  )
}

export const formatEachName: {
  (template: string, row: EachValue, options?: EachNameOptions): string
  (row: EachValue, options?: EachNameOptions): (template: string) => string
} = dual((args: IArguments): boolean => args.length >= 2, formatEachNameDataFirst)
