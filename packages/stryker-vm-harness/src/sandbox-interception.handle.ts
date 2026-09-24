import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'

import { harnessSourceFor, harnessUrlForSpecifier } from './harness-sources.schema.js'
import type {
  ActivateSandboxCommand,
  HarnessModuleBuiltin,
  LoadHookSync,
  ResolveContext,
  ResolveFnOutput,
  ResolveHookSync,
} from './sandbox.schema.js'

type AnyDecoded<A = unknown> = A

const HARNESS_PREFIX = 'vmrunner-harness:'

interface ActiveSandbox {
  readonly prefix: string
}

interface InterceptionState {
  readonly activeSandboxes: ActiveSandbox[]
  installed: boolean
  hooks: { readonly deregister: () => void } | undefined
}

const interceptionState: InterceptionState = {
  activeSandboxes: [],
  installed: false,
  hooks: undefined,
}

const activeSandbox = (): ActiveSandbox | undefined =>
  interceptionState.activeSandboxes[interceptionState.activeSandboxes.length - 1]

const parentUrlOf = (context: ResolveContext): string =>
  Option.getOrElse(Option.fromNullishOr(context.parentURL), () => '')

const isSandboxFile = (url: string | undefined, prefix: string): boolean =>
  Option.exists(Option.fromNullishOr(url), (present) => present.startsWith(prefix))

const saltIn = (url: string): string | undefined => {
  const marker = '?salt='
  const at = url.indexOf(marker)
  return at === -1 ? undefined : url.slice(at + marker.length)
}

const saltOf = (url: string | undefined): string | null =>
  Option.getOrNull(Option.flatMap(Option.fromNullishOr(url), (present) => Option.fromNullishOr(saltIn(present))))

const withSalt = (url: string, salt: string | null): string =>
  Option.getOrElse(Option.map(Option.fromNullishOr(salt), (present) => `${url}?salt=${present}`), () => url)

const hasSalt = (url: string): boolean => Boolean.or(url.includes('?salt='), url.includes('&salt='))

const appendedSalt = (url: string, salt: string): string =>
  `${url}${Boolean.match(url.includes('?'), { onTrue: () => '&', onFalse: () => '?' })}salt=${salt}`

const withoutQuery = (url: string): string =>
  Boolean.match(url.includes('?'), {
    onTrue: () => url.slice(0, url.indexOf('?')),
    onFalse: () => url,
  })

const harnessModuleSource = (url: string): Option.Option<string> =>
  Boolean.match(url.startsWith(HARNESS_PREFIX), {
    onTrue: () => Option.fromNullishOr(harnessSourceFor(withoutQuery(url))),
    onFalse: () => Option.none(),
  })

const resolveFromHarness = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Option.match(Option.fromNullishOr(sandbox), {
    onNone: () => {
      throw new Error(`No in-memory runner is active; cannot resolve "${specifier}" for a harness module.`)
    },
    onSome: (active) => nextResolve(specifier, { ...context, parentURL: active.prefix }),
  })

const canRetryAsTypeScript = (
  specifier: string,
  context: ResolveContext,
  sandbox: ActiveSandbox | undefined,
): boolean =>
  Boolean.and(
    Option.exists(Option.fromNullishOr(sandbox), (active) => isSandboxFile(parentUrlOf(context), active.prefix)),
    specifier.endsWith('.js'),
  )

const retryAsTypeScript = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
  sandbox: ActiveSandbox | undefined,
  cause: AnyDecoded,
): ResolveFnOutput =>
  Boolean.match(canRetryAsTypeScript(specifier, context, sandbox), {
    onTrue: () => nextResolve(`${specifier.slice(0, -3)}.ts`, context),
    onFalse: () => {
      throw cause
    },
  })

const scopedWithSalt = (
  resolved: ResolveFnOutput,
  sandbox: ActiveSandbox | undefined,
  salt: string,
): ResolveFnOutput =>
  Boolean.match(
    Boolean.and(
      Option.exists(Option.fromNullishOr(sandbox), (active) => resolved.url.startsWith(active.prefix)),
      Boolean.not(hasSalt(resolved.url)),
    ),
    {
      onTrue: () => ({ url: appendedSalt(resolved.url, salt), shortCircuit: true }),
      onFalse: () => resolved,
    },
  )

const saltScoped = (
  resolved: ResolveFnOutput,
  context: ResolveContext,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Option.match(Option.fromNullishOr(saltOf(parentUrlOf(context))), {
    onNone: () => resolved,
    onSome: (salt) => scopedWithSalt(resolved, sandbox, salt),
  })

const nextResolveOutcome = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
): Result.Result<ResolveFnOutput, AnyDecoded> =>
  Result.try({
    try: (): ResolveFnOutput => nextResolve(specifier, context),
    catch: (cause) => cause,
  })

const resolveDelegated = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Result.match(nextResolveOutcome(specifier, context, nextResolve), {
    onFailure: (cause) => retryAsTypeScript(specifier, context, nextResolve, sandbox, cause),
    onSuccess: (resolved) => saltScoped(resolved, context, sandbox),
  })

const scopedHarnessUrl = (
  specifier: string,
  parent: string,
  sandbox: ActiveSandbox | undefined,
): Option.Option<string> =>
  Option.flatMap(
    Option.filter(Option.fromNullishOr(sandbox), (active) => isSandboxFile(parent, active.prefix)),
    () =>
      Option.map(
        Option.fromNullishOr(harnessUrlForSpecifier(specifier)),
        (url) => withSalt(url, saltOf(parent)),
      ),
  )

const resolveMappedOrDelegated = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Option.match(scopedHarnessUrl(specifier, parentUrlOf(context), sandbox), {
    onNone: () => resolveDelegated(specifier, context, nextResolve, sandbox),
    onSome: (url) => ({ url, shortCircuit: true }),
  })

const resolveFromSandbox = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Boolean.match(specifier.startsWith(HARNESS_PREFIX), {
    onTrue: () => ({ url: specifier, shortCircuit: true }),
    onFalse: () => resolveMappedOrDelegated(specifier, context, nextResolve, sandbox),
  })

const resolveRequest = (
  specifier: string,
  context: ResolveContext,
  nextResolve: ResolveHookSync,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Boolean.match(parentUrlOf(context).startsWith(HARNESS_PREFIX), {
    onTrue: () => resolveFromHarness(specifier, context, nextResolve, sandbox),
    onFalse: () => resolveFromSandbox(specifier, context, nextResolve, sandbox),
  })

const resolveWithin: ResolveHookSync = (specifier, context, nextResolve) =>
  resolveRequest(specifier, context, nextResolve, activeSandbox())

const loadWithin: LoadHookSync = (url, context, nextLoad) =>
  Option.match(harnessModuleSource(url), {
    onNone: () => nextLoad(url, context),
    onSome: (source) => ({ format: 'module', source, shortCircuit: true }),
  })

const sandboxGate = Semaphore.makeUnsafe(1)

export const installInterceptionCell: Cell.Cell<HarnessModuleBuiltin, void> = Cell.fromEffect(Effect.void).pipe(
  Cell.mapInput((nodeModule: HarnessModuleBuiltin) => {
    if (!interceptionState.installed) {
      interceptionState.hooks = nodeModule.registerHooks({ resolve: resolveWithin, load: loadWithin })
      interceptionState.installed = true
    }
    return undefined
  }),
)

export const uninstallInterceptionCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionState.hooks?.deregister()
    interceptionState.hooks = undefined
    interceptionState.installed = false
  }),
)

export const activateSandboxCell: Cell.Cell<ActivateSandboxCommand, void> = Cell.mapInput(
  Cell.fromEffect(Effect.void),
  (command: ActivateSandboxCommand) => {
    Effect.runSync(
      Effect.sync(() => {
        interceptionState.activeSandboxes.push({ prefix: command.prefix })
      }).pipe(sandboxGate.withPermits(1)),
    )
    return undefined
  },
)

export const deactivateSandboxCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionState.activeSandboxes.pop()
  }),
)

export const installInterception = (nodeModule: HarnessModuleBuiltin): void => {
  Effect.runSync(installInterceptionCell.run(nodeModule))
}

export const uninstallInterception = (): void => {
  Effect.runSync(uninstallInterceptionCell.run(undefined))
}

export const activateSandbox = (prefix: string): void => {
  Effect.runSync(activateSandboxCell.run({ prefix }))
}

export const deactivateSandbox = (): void => {
  Effect.runSync(deactivateSandboxCell.run(undefined))
}

export const resetInterceptionForTests = (): void => {
  interceptionState.hooks?.deregister()
  interceptionState.hooks = undefined
  interceptionState.installed = false
  interceptionState.activeSandboxes.length = 0
}
