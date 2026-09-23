import * as Cause from 'effect/Cause'
import type * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { flow, pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'

import * as Schedule from 'effect/Schedule'
import type * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as TestClock from 'effect/testing/TestClock'
import * as TestConsole from 'effect/testing/TestConsole'
import * as Arbitrary from 'effect/unstable/arbitrary/Arbitrary'

import type {
  HarnessTestContext,
  HookApi,
  RegisteredTest,
  RegistrySuiteApi,
  RegistryTestApi,
} from '../core/registry.js'

export interface EffectTestOptions {
  readonly timeout?: number
  readonly arbitrary?: Arbitrary.CheckOptions
}

type PropertyTimeout = number | EffectTestOptions

type AnyDecoded<A = unknown> = A

export type ArbitraryInput =
  | S.Schema<AnyDecoded>
  | Arbitrary.Arbitrary<AnyDecoded>
  | ReadonlyArray<ArbitraryInput>
  | { readonly [key: string]: ArbitraryInput }

export type EffectTestFunction<R, A = unknown, E = unknown> = (context: HarnessTestContext) => Effect.Effect<A, E, R>

export interface EffectTesterVariants<R> {
  (name: string, self: EffectTestFunction<R>, timeout?: number | EffectTestOptions): void
  readonly each: EachBinder<R>
  readonly for: EachBinder<R>
}

export interface EachBinder<R> {
  <A = unknown>(cases: readonly A[]): <E = unknown>(name: string, self: EachFn<R, A, E>) => void
}

export type EachFn<R, A = unknown, E = unknown, B = unknown> = (
  ...args: ReadonlyArray<A | HarnessTestContext>
) => Effect.Effect<B, E, R>

export interface EffectTester<R> extends EffectTesterVariants<R> {
  readonly skip: EffectTesterVariants<R>
  readonly only: EffectTesterVariants<R>
  readonly fails: EffectTesterVariants<R>
  readonly prop: PropBinder
}

export interface PropBinder {
  <A = unknown, R = unknown>(
    name: string,
    arbitraries: ArbitraryInput,
    self: (values: A, context: HarnessTestContext) => R,
    timeout?: PropertyTimeout,
  ): void
}

export interface EffectVitestIt extends RegistryTestApi {
  readonly describe: RegistrySuiteApi
  readonly effect: EffectTester<Scope.Scope>
  readonly live: EffectTester<Scope.Scope>
  readonly prop: PropBinder
  readonly flakyTest: <A, E, R2>(
    self: Effect.Effect<A, E, R2 | Scope.Scope>,
    timeout?: Duration.Input,
  ) => Effect.Effect<A, never, R2>
  readonly layer: LayerBinder
}

export interface LayeredVitestIt<R2> extends RegistryTestApi {
  readonly describe: RegistrySuiteApi
  readonly effect: EffectTester<Scope.Scope | R2>
  readonly live: EffectTester<Scope.Scope | R2>
  readonly prop: PropBinder
  readonly flakyTest: <A, E, R3>(
    self: Effect.Effect<A, E, R3 | Scope.Scope>,
    timeout?: Duration.Input,
  ) => Effect.Effect<A, never, R3>
  readonly layer: LayerBinder
}

export interface LayerBinder {
  <R, E>(
    layer: Layer.Layer<R, E>,
    options?: {
      readonly memoMap?: Layer.MemoMap
      readonly timeout?: Duration.Input
      readonly excludeTestServices?: boolean
    },
  ): {
    (f: (it: LayeredVitestIt<R>) => void): void
    (name: string, f: (it: LayeredVitestIt<R>) => void): void
  }
}

export interface LayerRegistrationContext {
  readonly api: RegistryTestApi
  readonly describe: RegistrySuiteApi
  readonly hooks: HookApi
  readonly tests: readonly RegisteredTest[]
}

export interface EffectAdapterRegistration {
  readonly api: RegistryTestApi
  readonly describe: RegistrySuiteApi
  readonly hooks: HookApi
  readonly tests: readonly RegisteredTest[]
}

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())
const runTest =
  (context: HarnessTestContext) => <A = unknown, E = unknown>(effect: Effect.Effect<A, E, never>): Promise<void> => {
    const promise = Effect.runPromiseExit(effect).then((exit) => {
      if (Exit.isFailure(exit)) {
        const errors = Cause.prettyErrors(exit.cause)
        const errorToThrow = errors.length > 0 ? errors[0] : new Error(Cause.pretty(exit.cause))
        throw errorToThrow instanceof Error ? errorToThrow : new Error('effect failed', { cause: errorToThrow })
      }
    })
    const onAbort = () => context.onTestFinished(() => promise.then(() => {}, () => {}))
    context.signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      () => context.signal.removeEventListener('abort', onAbort),
      () => context.signal.removeEventListener('abort', onAbort),
    )
    return promise
  }

const testOptions = (timeout?: number | EffectTestOptions): EffectTestOptions =>
  typeof timeout === 'number' ? { timeout } : (timeout ?? {})

const checkOptions = (timeout: PropertyTimeout | undefined): Arbitrary.CheckOptions | undefined =>
  typeof timeout === 'number' ? undefined : timeout?.arbitrary
const compileArbitraryInput = (input: ArbitraryInput): Arbitrary.Arbitrary<AnyDecoded> =>
  Arbitrary.isArbitrary(input) ? input : Arbitrary.schema(input as never)
const makeArbitrary = (arbitraries: ArbitraryInput): Arbitrary.Arbitrary<AnyDecoded> => {
  if (Arbitrary.isArbitrary(arbitraries)) {
    return arbitraries
  }
  if (Array.isArray(arbitraries)) {
    return Arbitrary.all(arbitraries.map(compileArbitraryInput))
  }
  if (typeof arbitraries === 'object') {
    const record: Record<string, Arbitrary.Arbitrary<AnyDecoded>> = {}
    for (const [key, value] of Object.entries(arbitraries)) {
      record[key] = compileArbitraryInput(value)
    }
    return Arbitrary.all(record)
  }
  return compileArbitraryInput(arbitraries)
}

const normalizeProperty = <A = unknown, E = unknown>(
  property: (value: A) => boolean | Effect.Effect<boolean, E, never>,
  value: A,
): Effect.Effect<boolean, E | Cause.Cause<E>, never> =>
  Effect.catchCause(
    Effect.suspend(() => {
      const output = property(value)
      return Effect.isEffect(output) ? output : Effect.succeed(output)
    }),
    (cause) => Effect.fail(cause),
  )

const runCheck = <A = unknown, E = unknown>(
  context: HarnessTestContext,
  arbitrary: Arbitrary.Arbitrary<AnyDecoded>,
  property: (values: A) => boolean | Effect.Effect<boolean, E, never>,
  options: Arbitrary.CheckOptions | undefined,
): Promise<void> =>
  runTest(context)(
    Effect.flatMap(
      Arbitrary.checkEffect(arbitrary, (value) => normalizeProperty(property, value as A), options),
      (result) => {
        const failure = Arbitrary.formatCheckFailure(result)
        return failure === undefined ? Effect.void : Effect.die(new Error(failure))
      },
    ),
  )

type VariantBinder = (
  name: string,
  options: EffectTestOptions,
  fn: (context: HarnessTestContext) => Promise<void>,
) => void

const makeEach = <R>(
  variant: VariantBinder,
  mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, never>,
): EachBinder<R> =>
<A = unknown>(cases: readonly A[]) =>
<E = unknown>(name: string, self: EachFn<R, A, E>) => {
  for (const [index, row] of cases.entries()) {
    const args: readonly A[] = Array.isArray(row) ? row : [row]
    variant(`${name} [${index}]`, {}, (context: HarnessTestContext) =>
      pipe(
        Effect.suspend(() => {
          const res = self(...args, context)
          return Effect.asVoid(Effect.isEffect(res) ? res : Effect.succeed(res))
        }),
        mapEffect,
        runTest(context),
      ))
  }
}

const makeTester = <R>(
  mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, never>,
  it: RegistryTestApi,
): EffectTester<R> => {
  const run = <A = unknown, E = unknown>(
    context: HarnessTestContext,
    self: (context: HarnessTestContext) => Effect.Effect<A, E, R>,
  ) => pipe(Effect.suspend(() => self(context)), mapEffect, runTest(context))

  const makeVariant = (variant: VariantBinder): EffectTesterVariants<R> =>
    Object.assign(
      (
        name: string,
        self: EffectTestFunction<R>,
        timeout?: number | EffectTestOptions,
      ) => {
        variant(name, testOptions(timeout), (context: HarnessTestContext) => run(context, self))
      },
      {
        each: makeEach(variant, mapEffect),
        for: makeEach(variant, mapEffect),
      },
    )

  const prop = <A = unknown, E = unknown>(
    name: string,
    arbitraries: ArbitraryInput,
    self: (values: A, context: HarnessTestContext) => boolean | Effect.Effect<boolean, E, R>,
    timeout?: number | EffectTestOptions,
  ): void => {
    const arbitrary = makeArbitrary(arbitraries)
    it(
      name,
      testOptions(timeout),
      (context: HarnessTestContext) =>
        runCheck<A, E>(
          context,
          arbitrary,
          (values: A) =>
            mapEffect(
              Effect.suspend(() => {
                const output = self(values, context)
                return Effect.isEffect(output)
                  ? Effect.map(output, (v) => v !== false)
                  : Effect.succeed(output !== false)
              }),
            ),
          checkOptions(timeout),
        ),
    )
  }

  return Object.assign(
    (
      name: string,
      self: EffectTestFunction<R>,
      timeout?: number | EffectTestOptions,
    ) => {
      it(name, testOptions(timeout), (context: HarnessTestContext) => run(context, self))
    },
    {
      skip: makeVariant((name, options, fn) => it.skip(name, options, fn)),
      only: makeVariant((name, options, fn) => it.only(name, options, fn)),
      fails: makeVariant((name, options, fn) => it.fails(name, options, fn)),
      each: makeEach((name, options, fn) => it(name, options, fn), mapEffect),
      for: makeEach((name, options, fn) => it(name, options, fn), mapEffect),
      prop: prop as PropBinder,
    },
  )
}

const standaloneProp = (it: RegistryTestApi): PropBinder =>
<A = unknown, E = unknown>(
  name: string,
  arbitraries: ArbitraryInput,
  self: (values: A, context: HarnessTestContext) => E,
  timeout?: number | EffectTestOptions,
) => {
  const arbitrary = makeArbitrary(arbitraries)
  it(
    name,
    testOptions(timeout),
    (context: HarnessTestContext) =>
      runCheck<A, E>(
        context,
        arbitrary,
        (values: A) => self(values, context) !== false,
        checkOptions(timeout),
      ),
  )
}

const flakyTest = <A, E, R2>(
  self: Effect.Effect<A, E, R2 | Scope.Scope>,
  _timeout: Duration.Input = Duration.seconds(30),
): Effect.Effect<A, never, R2> =>
  pipe(
    self,
    Effect.scoped,
    Effect.sandbox,
    Effect.retry(Schedule.recurs(10)),
    Effect.orDie,
  )

const makeItProxy = <R>(
  it: RegistryTestApi,
  overrides: Partial<LayeredVitestIt<R>>,
  describe: RegistrySuiteApi,
): LayeredVitestIt<R> =>
  new Proxy(it, {
    apply(target, thisArg, argArray) {
      return Reflect.apply(target, thisArg, argArray)
    },
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) {
        return Reflect.get(overrides, property)
      }
      if (property === 'describe') {
        return describe
      }
      return Reflect.get(target, property, receiver)
    },
  }) as LayeredVitestIt<R>

const runToPromise = <A = unknown, E = unknown>(
  effect: Effect.Effect<A, E, never> | Context.Context<never>,
): Promise<void> =>
  Effect.isEffect(effect)
    ? Effect.runPromise(Effect.asVoid(Effect.exit(effect))).then(() => {})
    : Promise.resolve()

const buildIntoScope = <E>(
  layer: Layer.Layer<never, E>,
  memoMap: Layer.MemoMap,
  scope: Scope.Scope,
): Context.Context<never> => Effect.runSync(pipe(Layer.buildWithMemoMap(layer, memoMap, scope), Effect.orDie))

const openLayerScopes = new Set<() => Promise<void>>()

export const closeOpenLayerScopes = (): Promise<void> => {
  const closers = [...openLayerScopes]
  openLayerScopes.clear()
  return Promise.all(closers.map((close) => close().catch(() => undefined))).then(() => undefined)
}

type LayeredBody<R> = (it: LayeredVitestIt<R>) => void
type LayeredArgs<R> = readonly [body: LayeredBody<R>] | readonly [name: string, body: LayeredBody<R>]

export const layerBinderFor = (context: LayerRegistrationContext): LayerBinder => {
  const binder = <R, E>(
    layer_: Layer.Layer<R, E>,
    options?: Parameters<LayerBinder>[1],
  ) =>
  (...args: LayeredArgs<R>): void => {
    const layer: Layer.Layer<never, E> = layer_
    const excludeTestServices = options?.excludeTestServices ?? false
    const withTestEnv = excludeTestServices ? layer : Layer.provideMerge(layer, TestEnv)
    const memoMap = options?.memoMap ?? Layer.makeMemoMapUnsafe()
    const scope = Scope.makeUnsafe('sequential')
    const built: Context.Context<never> = buildIntoScope(withTestEnv, memoMap, scope)
    let closed = false
    const closeScope = (): Promise<void> => {
      if (closed) {
        return Promise.resolve()
      }
      closed = true
      openLayerScopes.delete(closeScope)
      return runToPromise(Scope.close(scope, Exit.void))
    }
    openLayerScopes.add(closeScope)

    const makeIt = <S2>(base: RegistryTestApi): LayeredVitestIt<S2> =>
      makeItProxy<S2>(
        base,
        {
          effect: makeTester<Scope.Scope | S2>(
            (effect) => pipe(effect, Effect.scoped, Effect.provide(built as Context.Context<Scope.Scope | S2>)),
            base,
          ),
          layer: <R2, E2>(
            nestedLayer: Layer.Layer<R2, E2>,
            nestedOptions?: Parameters<LayerBinder>[1],
          ) =>
            layerBinderFor(context)(
              Layer.provideMerge(nestedLayer, withTestEnv),
              { ...nestedOptions, memoMap: Layer.forkMemoMapUnsafe(memoMap), excludeTestServices },
            ),
        },
        context.describe,
      )

    if (typeof args[0] === 'function') {
      const body = args[0]
      const firstNewTest = context.tests.length
      body(makeIt<R>(context.api))
      const blockTaskSet = new Set<RegisteredTest>(context.tests.slice(firstNewTest))
      let remaining = blockTaskSet.size
      context.hooks.beforeEach((ctx) => {
        if (!blockTaskSet.has(ctx.task as RegisteredTest)) {
          return undefined
        }
        ctx.onTestFinished(() => {
          remaining -= 1
          if (remaining === 0) {
            return closeScope()
          }
          return undefined
        })
        return runToPromise(built)
      })
      context.hooks.afterAll(() => closeScope())
      return
    }

    const [name, body] = args as readonly [name: string, body: LayeredBody<R>]
    context.describe(name, () => {
      context.hooks.beforeAll(() => runToPromise(built))
      context.hooks.afterAll(() => closeScope())
      body(makeIt<R>(context.api))
    })
  }
  return binder
}
export const makeEffectMethods = (context: EffectAdapterRegistration): EffectVitestIt => {
  const effect = makeTester<Scope.Scope>(flow(Effect.scoped, Effect.provide(TestEnv)), context.api)
  const live = makeTester<Scope.Scope>(Effect.scoped, context.api)
  const prop = standaloneProp(context.api)
  return makeItProxy(
    context.api,
    {
      effect,
      live,
      prop,
      flakyTest,
      layer: layerBinderFor(context),
    },
    context.describe,
  )
}
