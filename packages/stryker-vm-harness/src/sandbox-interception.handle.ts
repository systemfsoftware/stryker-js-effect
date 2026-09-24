import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'
import type { LoadHookSync, ResolveFnOutput, ResolveHookContext, ResolveHookSync } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { harnessSourceFor, harnessUrlForSpecifier } from './harness-sources.handle.js'
import type {
  ActivateSandboxCommand,
  HarnessModuleBuiltin,
  InstallInterceptionCommand,
  InterceptionRuntime,
} from './sandbox.schema.js'
import { runLoadStage, runResolveStage, type VmLoadTerminal, type VmResolveTerminal } from './session-plugin.js'
import { VM_VITEST_BAG_KEY } from './vitest-host/runtime.js'

type AnyDecoded<A = unknown> = A

const HARNESS_PREFIX = 'vmrunner-harness:'
const FS_PREFIX = '/@fs/'
const SALT_QUERY = /[?&]salt=([^&#]*)/

const SERVED_SPECIFIERS: ReadonlyArray<string> = ['vitest', '@effect/vitest', '@systemfsoftware/effect-gherkin-spec']

interface ActiveSandbox {
  readonly prefix: string
}

interface InterceptionState {
  readonly activeSandboxes: ActiveSandbox[]
  runtime: InterceptionRuntime | undefined
  installed: boolean
  hooks: { readonly deregister: () => void } | undefined
}

const interceptionState: InterceptionState = {
  activeSandboxes: [],
  runtime: undefined,
  installed: false,
  hooks: undefined,
}

const activeSandbox = (): ActiveSandbox | undefined =>
  interceptionState.activeSandboxes[interceptionState.activeSandboxes.length - 1]

const parentUrlOf = (context: { readonly parentURL?: string | undefined }): string =>
  Option.getOrElse(Option.fromNullishOr(context.parentURL), () => '')

const isSandboxFile = (url: string | undefined, prefix: string): boolean =>
  Option.exists(Option.fromNullishOr(url), (present) => present.startsWith(prefix))

const withinSandbox = (sandbox: ActiveSandbox | undefined, url: string | undefined): boolean =>
  Option.exists(Option.fromNullishOr(sandbox), (active) => isSandboxFile(url, active.prefix))

const saltOf = (url: string | undefined): string | null => {
  const found = Option.flatMap(Option.fromNullishOr(url), (present) => Option.fromNullishOr(SALT_QUERY.exec(present)))
  return Option.match(found, {
    onNone: () => null,
    onSome: (match) => Option.getOrNull(Option.fromNullishOr(match[1])),
  })
}

const stripSaltQuery = (url: string): string => {
  const stripped = url.replace(/[?&]salt=[^&#]*/, '')
  return Boolean.match(stripped.endsWith('?'), {
    onTrue: () => stripped.slice(0, -1),
    onFalse: () => stripped,
  })
}

const withSalt = (url: string, salt: string | null): string =>
  Option.getOrElse(Option.map(Option.fromNullishOr(salt), (present) => `${url}?salt=${present}`), () => url)

const hasSalt = (url: string): boolean => Boolean.or(url.includes('?salt='), url.includes('&salt='))

const appendedSalt = (url: string, salt: string): string =>
  `${url}${Boolean.match(url.includes('?'), { onTrue: () => '&', onFalse: () => '?' })}salt=${salt}`

const saltScopedWithin = (
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
      onTrue: () => ({ ...resolved, url: appendedSalt(resolved.url, salt), shortCircuit: true }),
      onFalse: () => resolved,
    },
  )

const parentSaltScoped = (
  resolved: ResolveFnOutput,
  parent: string,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Option.match(Option.fromNullishOr(saltOf(parent)), {
    onNone: () => resolved,
    onSome: (salt) => saltScopedWithin(resolved, sandbox, salt),
  })

const splitQueryOf = (specifier: string): { readonly bare: string; readonly query: string } => {
  const queryAt = specifier.indexOf('?')
  return Boolean.match(queryAt === -1, {
    onTrue: () => ({ bare: specifier, query: '' }),
    onFalse: () => ({ bare: specifier.slice(0, queryAt), query: specifier.slice(queryAt) }),
  })
}

const projectRootFor = (parent: string): string | undefined => {
  const runtime = interceptionState.runtime?.host.state.read<
    { readonly projectFor: (file: string) => { readonly root?: string | undefined } }
  >(VM_VITEST_BAG_KEY)
  const projectFor = runtime?.projectFor
  if (projectFor === undefined) {
    return undefined
  }
  return Result.match(
    Result.try({
      try: () => projectFor(fileURLToPath(stripSaltQuery(parent))).root,
      catch: () => undefined,
    }),
    { onFailure: () => undefined, onSuccess: (root) => root },
  )
}

const viteFileUrlOf = (
  specifier: string,
  parent: string,
  sandbox: ActiveSandbox | undefined,
): string | undefined => {
  if (!withinSandbox(sandbox, parent) || sandbox === undefined) {
    return undefined
  }
  const { bare, query } = splitQueryOf(specifier)
  if (bare.startsWith(FS_PREFIX)) {
    return `${pathToFileURL(`/${bare.slice(FS_PREFIX.length)}`).href}${query}`
  }
  if (bare.startsWith('/') && !bare.startsWith('//')) {
    if (process.getBuiltinModule('node:fs').existsSync(bare)) {
      return `${pathToFileURL(bare).href}${query}`
    }
    const root = projectRootFor(parent) ?? fileURLToPath(sandbox.prefix)
    return `${pathToFileURL(root).href.replace(/\/?$/, '/')}${bare.slice(1)}${query}`
  }
  return undefined
}

const packageNameOfSpecifier = (specifier: string): string | undefined => {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope === undefined || name === undefined ? undefined : `${scope}/${name}`
  }
  const [name] = specifier.split('/')
  return name
}

const realpathOrUndefined = (path: string): string | undefined =>
  Result.match(
    Result.try({
      try: () => process.getBuiltinModule('node:fs').realpathSync(path),
      catch: () => undefined,
    }),
    { onFailure: () => undefined, onSuccess: (real) => real },
  )

const packageNameOfFileUrl = (fileUrl: string): string | undefined => {
  const real = realpathOrUndefined(fileURLToPath(splitQueryOf(fileUrl).bare))
  if (real === undefined) {
    return undefined
  }
  const segments = real.split('/')
  const owner = segments.lastIndexOf('node_modules')
  if (owner === -1) {
    return undefined
  }
  const name = segments[owner + 1]
  if (name === undefined) {
    return undefined
  }
  if (name.startsWith('@')) {
    const scopeChild = segments[owner + 2]
    return scopeChild === undefined ? undefined : `${name}/${scopeChild}`
  }
  return name
}

const harnessUrlForResolvedFile = (fileUrl: string): string | undefined => {
  const candidate = packageNameOfFileUrl(fileUrl)
  if (candidate === undefined) {
    return undefined
  }
  const served = SERVED_SPECIFIERS.find((specifier) => packageNameOfSpecifier(specifier) === candidate)
  return served === undefined ? undefined : harnessUrlForSpecifier(served)
}

const tryResolve = (
  specifier: string,
  context: Partial<ResolveHookContext>,
  nextResolve: VmResolveTerminal,
): Result.Result<ResolveFnOutput, AnyDecoded> =>
  Result.try({
    try: (): ResolveFnOutput => nextResolve(specifier, context),
    catch: (cause) => cause,
  })

const nativeResolveOf =
  (sandbox: ActiveSandbox | undefined, nextResolve: VmResolveTerminal): VmResolveTerminal => (specifier, context) =>
    Result.match(tryResolve(specifier, context ?? {}, nextResolve), {
      onSuccess: (resolved) => resolved,
      onFailure: (cause) =>
        Boolean.match(
          Boolean.and(withinSandbox(sandbox, parentUrlOf(context ?? {})), specifier.endsWith('.js')),
          {
            onTrue: () => nextResolve(`${specifier.slice(0, -3)}.ts`, context),
            onFalse: () => {
              throw cause
            },
          },
        ),
    })

const resolveThroughPlugins = (
  specifier: string,
  context: ResolveHookContext,
  nativeResolve: VmResolveTerminal,
): ResolveFnOutput => {
  const runtime = interceptionState.runtime
  return runtime === undefined
    ? nativeResolve(specifier, context)
    : runResolveStage(runtime.plugins, runtime.host, specifier, context, nativeResolve)
}

const resolveFromHarness = (
  specifier: string,
  context: ResolveHookContext,
  nextResolve: VmResolveTerminal,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput => {
  if (sandbox === undefined) {
    throw new Error(`No in-memory runner is active; cannot resolve "${specifier}" for a harness module.`)
  }
  const scoped: Partial<ResolveHookContext> = { ...context, parentURL: sandbox.prefix }
  return Result.match(tryResolve(specifier, scoped, nextResolve), {
    onSuccess: (resolved) => resolved,
    onFailure: (cause) => {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        throw cause
      }
      const host = interceptionState.runtime?.host
      if (host === undefined) {
        throw cause
      }
      return nextResolve(new URL(host.resolveVitestModule(specifier), sandbox.prefix).href, scoped)
    },
  })
}

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

const resolveDelegated = (
  specifier: string,
  context: ResolveHookContext,
  nextResolve: VmResolveTerminal,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput => {
  const parent = parentUrlOf(context)
  const nativeResolve = nativeResolveOf(sandbox, nextResolve)
  const mapped = viteFileUrlOf(specifier, parent, sandbox)
  if (mapped === undefined) {
    return parentSaltScoped(resolveThroughPlugins(specifier, context, nativeResolve), parent, sandbox)
  }
  const served = harnessUrlForResolvedFile(mapped)
  if (served !== undefined) {
    return { url: withSalt(served, saltOf(parent)), shortCircuit: true }
  }
  const servable = splitQueryOf(mapped).bare
  return parentSaltScoped(
    resolveThroughPlugins(servable, { ...context, parentURL: parent }, nativeResolve),
    parent,
    sandbox,
  )
}

const resolveWithin: ResolveHookSync = (specifier, context, nextResolve) => {
  const parent = parentUrlOf(context)
  const sandbox = activeSandbox()
  if (parent.startsWith(HARNESS_PREFIX)) {
    return resolveFromHarness(specifier, context, nextResolve, sandbox)
  }
  if (specifier.startsWith(HARNESS_PREFIX)) {
    return { url: specifier, shortCircuit: true }
  }
  return Option.match(scopedHarnessUrl(specifier, parent, sandbox), {
    onNone: () => resolveDelegated(specifier, context, nextResolve, sandbox),
    onSome: (url) => ({ url, shortCircuit: true }),
  })
}

const harnessModuleSource = (url: string): string | undefined => {
  if (!url.startsWith(HARNESS_PREFIX)) {
    return undefined
  }
  const queryAt = url.indexOf('?')
  return Boolean.match(queryAt === -1, {
    onTrue: () => harnessSourceFor(url),
    onFalse: () => harnessSourceFor(url.slice(0, queryAt)),
  })
}

const saltedLoadTerminalOf = (nextLoad: VmLoadTerminal): VmLoadTerminal => (url, context) =>
  Boolean.match(url.startsWith('file:') && saltOf(url) !== null, {
    onTrue: () => {
      const loaded = nextLoad(stripSaltQuery(url), context)
      if (loaded.source === undefined || typeof loaded.format !== 'string' || !loaded.format.startsWith('module')) {
        return loaded
      }
      return { format: loaded.format, source: loaded.source, shortCircuit: true }
    },
    onFalse: () => nextLoad(url, context),
  })

const loadWithin: LoadHookSync = (url, context, nextLoad) => {
  const source = harnessModuleSource(url)
  if (source !== undefined) {
    return { format: 'module', source, shortCircuit: true }
  }
  const runtime = interceptionState.runtime
  return runtime === undefined
    ? nextLoad(url, context)
    : runLoadStage(runtime.plugins, runtime.host, url, context, saltedLoadTerminalOf(nextLoad))
}

const sandboxGate = Semaphore.makeUnsafe(1)

const installInterceptionCell: Cell.Cell<InstallInterceptionCommand, void> = Cell.mapInput(
  Cell.fromEffect(Effect.void),
  (command: InstallInterceptionCommand) => {
    if (!interceptionState.installed) {
      interceptionState.hooks = command.nodeModule.registerHooks({ resolve: resolveWithin, load: loadWithin })
      interceptionState.installed = true
    }
    interceptionState.runtime = command.runtime
    return undefined
  },
)

const uninstallInterceptionCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionState.hooks?.deregister()
    interceptionState.hooks = undefined
    interceptionState.installed = false
  }),
)

const activateSandboxCell: Cell.Cell<ActivateSandboxCommand, void> = Cell.mapInput(
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

const deactivateSandboxCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionState.activeSandboxes.pop()
  }),
)

export const installInterception = (nodeModule: HarnessModuleBuiltin, runtime: InterceptionRuntime): void => {
  Effect.runSync(installInterceptionCell.run({ nodeModule, runtime }))
}

export const uninstallInterception = (): void => {
  Effect.runSync(uninstallInterceptionCell.run(undefined))
  interceptionState.runtime = undefined
}

export const activateSandbox = (prefix: string): void => {
  Effect.runSync(activateSandboxCell.run({ prefix }))
}

export const deactivateSandbox = (): void => {
  Effect.runSync(deactivateSandboxCell.run(undefined))
}
