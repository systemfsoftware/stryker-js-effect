import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import type * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schedule from 'effect/Schedule'
import * as Scope from 'effect/Scope'
import * as TestClock from 'effect/testing/TestClock'
import * as TestConsole from 'effect/testing/TestConsole'
import * as Arbitrary from 'effect/unstable/arbitrary/Arbitrary'

import type {
  ArbitraryInput,
  EachBinder,
  EachFn,
  EffectAdapterRegistration,
  EffectTester,
  EffectTesterVariants,
  EffectTestFunction,
  EffectTestOptions,
  EffectVitestIt,
  LayerBinder,
  LayerBinderOptions,
  LayeredVitestIt,
  PropBinder,
  PropertyTimeout,
} from './effect-adapter.schema.js'
import type { HarnessTestContext, RegistryTaskInfo, RegistryTestApi } from './registry.schema.js'

type AnyDecoded<A = unknown> = A

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

const failureErrorOf = (cause: Cause.Cause<AnyDecoded>): Error =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(Cause.prettyErrors(cause)[0]), (error) => error),
    () => new Error(Cause.pretty(cause)),
  )

const runTest =
  (context: HarnessTestContext) => <A = unknown, E = unknown>(effect: Effect.Effect<A, E, never>): Promise<void> => {
    const promise = Effect.runPromiseExit(effect).then((exit) => {
      if (Exit.isFailure(exit)) {
        throw failureErrorOf(exit.cause)
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
  Match.value(timeout).pipe(
    Match.when(Predicate.isNumber, (millis) => ({ timeout: millis })),
    Match.orElse((options) => options ?? {}),
  )

const isTestOptions = (value: PropertyTimeout): value is EffectTestOptions => typeof value === 'object'

const checkOptions = (timeout: PropertyTimeout | undefined): Arbitrary.CheckOptions | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.filter(Option.fromNullishOr(timeout), isTestOptions),
      (options) => Option.fromNullishOr(options.arbitrary),
    ),
  )

const makeArbitrary = <A = AnyDecoded>(input: ArbitraryInput<A>): Arbitrary.Arbitrary<A> =>
  Match.value(input).pipe(
    Match.when(Arbitrary.isArbitrary, (arbitrary) => arbitrary),
    Match.orElse((schema) => Arbitrary.schema(schema)),
  )

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
  arbitrary: Arbitrary.Arbitrary<A>,
  property: (values: A) => boolean | Effect.Effect<boolean, E, never>,
  options: Arbitrary.CheckOptions | undefined,
): Promise<void> =>
  runTest(context)(
    Effect.flatMap(
      Arbitrary.checkEffect(arbitrary, (value) => normalizeProperty(property, value), options),
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
  cases.forEach((row, index) => {
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
  })
}

const propertyResult = <R, E>(
  mapEffect: <A, E2>(self: Effect.Effect<A, E2, R>) => Effect.Effect<A, E2, never>,
  produce: () => boolean | Effect.Effect<boolean, E, R>,
): Effect.Effect<boolean, E, never> =>
  mapEffect(
    Effect.suspend(() => {
      const output = produce()
      return Effect.isEffect(output)
        ? Effect.map(output, (value) => value !== false)
        : Effect.succeed(output !== false)
    }),
  )

const makeTester = <R>(
  mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, never>,
  it: RegistryTestApi,
): EffectTester<R> => {
  const run = <A = unknown, E = unknown>(
    context: HarnessTestContext,
    self: (context: HarnessTestContext) => Effect.Effect<A, E, R>,
  ): Promise<void> => pipe(Effect.suspend(() => self(context)), mapEffect, runTest(context))

  const makeVariant = (variant: VariantBinder): EffectTesterVariants<R> =>
    Object.assign(
      (name: string, self: EffectTestFunction<R>, timeout?: number | EffectTestOptions) => {
        variant(name, testOptions(timeout), (context: HarnessTestContext) => run(context, self))
      },
      {
        each: makeEach(variant, mapEffect),
        for: makeEach(variant, mapEffect),
      },
    )

  const prop = <A = unknown, E = unknown>(
    name: string,
    arbitraries: ArbitraryInput<A>,
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
          (values: A) => propertyResult(mapEffect, () => self(values, context)),
          checkOptions(timeout),
        ),
    )
  }

  return Object.assign(
    (name: string, self: EffectTestFunction<R>, timeout?: number | EffectTestOptions) => {
      it(name, testOptions(timeout), (context: HarnessTestContext) => run(context, self))
    },
    {
      skip: makeVariant((name, options, fn) => it.skip(name, options, fn)),
      only: makeVariant((name, options, fn) => it.only(name, options, fn)),
      fails: makeVariant((name, options, fn) => it.fails(name, options, fn)),
      each: makeEach((name, options, fn) => it(name, options, fn), mapEffect),
      for: makeEach((name, options, fn) => it(name, options, fn), mapEffect),
      prop,
    },
  )
}

const standaloneProp = (it: RegistryTestApi): PropBinder =>
<A = unknown, E = unknown>(
  name: string,
  arbitraries: ArbitraryInput<A>,
  self: (values: A, context: HarnessTestContext) => E,
  timeout?: number | EffectTestOptions,
) => {
  const arbitrary = makeArbitrary(arbitraries)
  it(
    name,
    testOptions(timeout),
    (context: HarnessTestContext) =>
      runCheck<A, E>(context, arbitrary, (values: A) => self(values, context) !== false, checkOptions(timeout)),
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

type LayeredOverrides<R> = Omit<LayeredVitestIt<R>, keyof RegistryTestApi>

const makeLayered = <R>(base: RegistryTestApi, overrides: LayeredOverrides<R>): LayeredVitestIt<R> => {
  const forwarding = (...args: ReadonlyArray<AnyDecoded>): AnyDecoded => {
    const result: AnyDecoded = Reflect.apply(base, undefined, args)
    return result
  }
  return Object.assign(forwarding, base, overrides)
}

const settleEffect = <A = unknown, E = unknown>(effect: Effect.Effect<A, E, never>): Promise<void> =>
  effect.pipe(Effect.exit, Effect.asVoid, Effect.runPromise).then(() => {})

const runToPromise = <A = unknown, E = unknown>(
  effect: Effect.Effect<A, E, never> | Context.Context<never>,
): Promise<void> => (Effect.isEffect(effect) ? settleEffect(effect) : Promise.resolve())

const buildIntoScope = <ROut, E>(
  layer: Layer.Layer<ROut, E>,
  memoMap: Layer.MemoMap,
  scope: Scope.Scope,
): Context.Context<ROut> => Effect.runSync(Layer.buildWithMemoMap(layer, memoMap, scope).pipe(Effect.orDie))

const openLayerScopes = new Set<() => Promise<void>>()

export const closeOpenLayerScopes = (): Promise<void> => {
  const closers = [...openLayerScopes]
  openLayerScopes.clear()
  return Promise.all(closers.map((close) => close().catch(() => undefined))).then(() => undefined)
}

interface OpenedLayer<ROut> {
  readonly built: Context.Context<ROut>
  readonly close: () => Promise<void>
  readonly memoMap: Layer.MemoMap
}

const openLayerScope = <ROut, E>(
  layer: Layer.Layer<ROut, E>,
  options: LayerBinderOptions | undefined,
): OpenedLayer<ROut> => {
  const memoMap = Option.getOrElse(Option.fromNullishOr(options?.memoMap), () => Layer.makeMemoMapUnsafe())
  const scope = Scope.makeUnsafe('sequential')
  const built: Context.Context<ROut> = buildIntoScope(layer, memoMap, scope)
  const closed = { value: false }
  const close = (): Promise<void> => {
    if (closed.value) {
      return Promise.resolve()
    }
    closed.value = true
    openLayerScopes.delete(close)
    return runToPromise(Scope.close(scope, Exit.void))
  }
  openLayerScopes.add(close)
  return { built, close, memoMap }
}

type LayeredBody<R> = (it: LayeredVitestIt<R>) => void
type LayeredArgs<R> = readonly [body: LayeredBody<R>] | readonly [name: string, body: LayeredBody<R>]

const isBodyOnly = <R>(args: LayeredArgs<R>): args is readonly [body: LayeredBody<R>] => Predicate.isFunction(args[0])

interface LayerInvocation<R> {
  readonly name: string | undefined
  readonly body: LayeredBody<R>
}

const invocationOf = <R>(args: LayeredArgs<R>): LayerInvocation<R> =>
  isBodyOnly(args) ? { name: undefined, body: args[0] } : { name: args[0], body: args[1] }

const blockFinalizer = (remaining: { value: number }, close: () => Promise<void>) => (): Promise<void> | undefined => {
  remaining.value -= 1
  return Match.value(remaining.value === 0).pipe(
    Match.when(true, () => close()),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )
}

interface LayerScopeHandle {
  readonly built: Context.Context<never>
  readonly close: () => Promise<void>
}

const beforeBlockHook = (
  blockTaskSet: ReadonlySet<RegistryTaskInfo>,
  remaining: { value: number },
  opened: LayerScopeHandle,
  ctx: HarnessTestContext,
): Promise<void> | undefined =>
  Match.value(blockTaskSet.has(ctx.task)).pipe(
    Match.when(true, () => {
      ctx.onTestFinished(blockFinalizer(remaining, opened.close))
      return runToPromise(opened.built)
    }),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )

const runBlock = <R>(
  context: EffectAdapterRegistration,
  opened: LayerScopeHandle,
  makeIt: (base: RegistryTestApi) => LayeredVitestIt<R>,
  body: LayeredBody<R>,
): void => {
  const firstNewTest = context.tests.length
  body(makeIt(context.api))
  const blockTaskSet = new Set<RegistryTaskInfo>(context.tests.slice(firstNewTest))
  const remaining = { value: blockTaskSet.size }
  context.hooks.beforeEach((ctx) => beforeBlockHook(blockTaskSet, remaining, opened, ctx))
  context.hooks.afterAll(() => opened.close())
}

const runNamedBlock = <R>(
  context: EffectAdapterRegistration,
  opened: LayerScopeHandle,
  makeIt: (base: RegistryTestApi) => LayeredVitestIt<R>,
  name: string,
  body: LayeredBody<R>,
): void => {
  context.describe(name, () => {
    context.hooks.beforeAll(() => runToPromise(opened.built))
    context.hooks.afterAll(() => opened.close())
    body(makeIt(context.api))
  })
}

const runLayered = <R>(
  context: EffectAdapterRegistration,
  opened: LayerScopeHandle,
  makeIt: (base: RegistryTestApi) => LayeredVitestIt<R>,
  args: LayeredArgs<R>,
): void => {
  const invocation = invocationOf(args)
  Option.match(Option.fromNullishOr(invocation.name), {
    onNone: () => runBlock(context, opened, makeIt, invocation.body),
    onSome: (name) => runNamedBlock(context, opened, makeIt, name, invocation.body),
  })
}

export const layerBinderFor = (context: EffectAdapterRegistration): LayerBinder => {
  const binder = <R, E>(layer_: Layer.Layer<R, E>, options?: LayerBinderOptions) => (...args: LayeredArgs<R>): void => {
    const excludeTestServices = Option.getOrElse(
      Option.flatMap(
        Option.fromNullishOr(options),
        (present) => Option.fromNullishOr(present.excludeTestServices),
      ),
      () => false,
    )
    const withTestEnv = Boolean.match(excludeTestServices, {
      onTrue: () => layer_,
      onFalse: () => Layer.provideMerge(layer_, TestEnv),
    })
    const opened = openLayerScope(withTestEnv, options)

    const nestedLayerBinder = <R2, E2>(
      nestedLayer: Layer.Layer<R2, E2>,
      nestedOptions?: LayerBinderOptions,
    ) =>
      layerBinderFor(context)(
        Layer.provideMerge(nestedLayer, withTestEnv),
        { ...nestedOptions, memoMap: Layer.forkMemoMapUnsafe(opened.memoMap), excludeTestServices },
      )

    const layeredOverrides = (base: RegistryTestApi): LayeredOverrides<R> => ({
      describe: context.describe,
      effect: makeTester<Scope.Scope | R>(
        (effect) => effect.pipe(Effect.scoped, Effect.provide(opened.built)),
        base,
      ),
      live: makeTester<Scope.Scope | R>((effect) => effect.pipe(Effect.scoped, Effect.provide(opened.built)), base),
      prop: standaloneProp(base),
      flakyTest,
      layer: nestedLayerBinder,
    })

    const makeIt = (base: RegistryTestApi): LayeredVitestIt<R> => makeLayered<R>(base, layeredOverrides(base))

    runLayered(context, opened, makeIt, args)
  }
  return binder
}

export const makeEffectMethods = (context: EffectAdapterRegistration): EffectVitestIt => {
  const base = context.api
  return makeLayered<never>(base, {
    describe: context.describe,
    effect: makeTester<Scope.Scope>((effect) => effect.pipe(Effect.scoped, Effect.provide(TestEnv)), base),
    live: makeTester<Scope.Scope>(Effect.scoped, base),
    prop: standaloneProp(base),
    flakyTest,
    layer: layerBinderFor(context),
  })
}
