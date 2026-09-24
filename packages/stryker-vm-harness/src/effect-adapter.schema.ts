import type * as Duration from 'effect/Duration'
import type * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import type * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import type * as Arbitrary from 'effect/unstable/arbitrary/Arbitrary'

import type {
  HarnessTestContext,
  HookApi,
  RegisteredTest,
  RegistrySuiteApi,
  RegistryTestApi,
} from './registry.schema.js'

export interface EffectTestOptions {
  readonly timeout?: number
  readonly arbitrary?: Arbitrary.CheckOptions
}

export type PropertyTimeout = number | EffectTestOptions

export type ArbitraryInput<A = unknown> = S.Schema<A> | Arbitrary.Arbitrary<A>

export type EffectTestFunction<R, A = unknown, E = unknown> = (context: HarnessTestContext) => Effect.Effect<A, E, R>

export type EachFn<R, A = unknown, E = unknown, B = unknown> = (
  ...args: ReadonlyArray<A | HarnessTestContext>
) => Effect.Effect<B, E, R>

export interface EachBinder<R> {
  <A = unknown>(cases: readonly A[]): <E = unknown>(name: string, self: EachFn<R, A, E>) => void
}

export interface EffectTesterVariants<R> {
  (name: string, self: EffectTestFunction<R>, timeout?: number | EffectTestOptions): void
  readonly each: EachBinder<R>
  readonly for: EachBinder<R>
}

export interface PropBinder {
  <A = unknown, R = unknown>(
    name: string,
    arbitraries: ArbitraryInput<A>,
    self: (values: A, context: HarnessTestContext) => R,
    timeout?: PropertyTimeout,
  ): void
}

export interface EffectPropBinder<R> {
  <A = unknown, E = unknown>(
    name: string,
    arbitraries: ArbitraryInput<A>,
    self: (values: A, context: HarnessTestContext) => boolean | Effect.Effect<boolean, E, R>,
    timeout?: PropertyTimeout,
  ): void
}

export interface EffectTester<R> extends EffectTesterVariants<R> {
  readonly skip: EffectTesterVariants<R>
  readonly only: EffectTesterVariants<R>
  readonly fails: EffectTesterVariants<R>
  readonly prop: EffectPropBinder<R>
}

export interface LayerBinderOptions {
  readonly memoMap?: Layer.MemoMap
  readonly timeout?: Duration.Input
  readonly excludeTestServices?: boolean
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
    options?: LayerBinderOptions,
  ): {
    (f: (it: LayeredVitestIt<R>) => void): void
    (name: string, f: (it: LayeredVitestIt<R>) => void): void
  }
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

export interface EffectAdapterRegistration {
  readonly api: RegistryTestApi
  readonly describe: RegistrySuiteApi
  readonly hooks: HookApi
  readonly tests: readonly RegisteredTest[]
}
