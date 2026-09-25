import { Cell, Handle } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'

import { harnessSourceFor, harnessUrlForSpecifier } from './harness-sources.js'
import type {
  ActivateSandboxCommand,
  HarnessModuleBuiltin,
  InstallInterceptionCommand,
  InterceptionRuntime,
} from './sandbox.schema.js'
import {
  type LoadFnOutput,
  type LoadHookContext,
  type LoadHookSync,
  type ResolveFnOutput,
  type ResolveHookContext,
  type ResolveHookSync,
  runLoadStage,
  runResolveStage,
  type VmLoadTerminal,
  type VmResolveTerminal,
} from './session-plugin.js'
import { VM_VITEST_BAG_KEY } from './vitest-host/runtime.js'

type AnyDecoded<A = unknown> = A

const nodeFileSystem = globalThis.process.getBuiltinModule('node:fs')
const nodeUrl = globalThis.process.getBuiltinModule('node:url')

const HARNESS_PREFIX = 'vmrunner-harness:'
const FS_PREFIX = '/@fs/'
const SALT_QUERY = /[?&]salt=([^&#]*)/
const NODE_MODULES_DIRECTORY = 'node_modules'
const SCOPED_PACKAGE_PREFIX = '@'

const SERVED_SPECIFIERS: ReadonlyArray<string> = ['vitest', '@effect/vitest', '@systemfsoftware/effect-gherkin-spec']

export const TypeId = Symbol.for('~systemfsoftware/stryker-vm-harness/SandboxInterception')
export type TypeId = typeof TypeId

interface ActiveSandbox {
  readonly prefix: string
}

interface InterceptionState {
  readonly activeSandboxes: ActiveSandbox[]
  readonly runModules: Set<string>
  runtime: InterceptionRuntime | undefined
  installed: boolean
  hooks: { readonly deregister: () => void } | undefined
}

const Interception = Handle.make<Record<string, never>, InterceptionState>()(TypeId)

export type Interception = Handle.Of<typeof Interception>

export const isSandboxInterception = Interception.is

const interception = Interception.make({}, {
  activeSandboxes: [],
  runModules: new Set<string>(),
  runtime: undefined,
  installed: false,
  hooks: undefined,
})

const interceptionStateOf = (): InterceptionState => Interception.slot(interception)

const activeSandbox = (): ActiveSandbox | undefined =>
  interceptionStateOf().activeSandboxes[interceptionStateOf().activeSandboxes.length - 1]

const parentUrlOf = (context: { readonly parentURL?: string | undefined }): string =>
  Option.getOrElse(Option.fromNullishOr(context.parentURL), () => '')

const isSandboxFile = (url: string | undefined, prefix: string): boolean =>
  Option.exists(Option.fromNullishOr(url), (present) => present.startsWith(prefix))

const withinSandbox = (sandbox: ActiveSandbox | undefined, url: string | undefined): boolean =>
  Option.exists(Option.fromNullishOr(sandbox), (active) => isSandboxFile(url, active.prefix))

const withinAnySandbox = (url: string): boolean =>
  interceptionStateOf().activeSandboxes.some((active) => isSandboxFile(url, active.prefix))

const saltOf = (url: string | undefined): string | null => {
  const found = Option.flatMap(Option.fromNullishOr(url), (present) => Option.fromNullishOr(SALT_QUERY.exec(present)))
  return Option.match(found, {
    onNone: () => null,
    onSome: (match) => Option.getOrNull(Option.fromNullishOr(match[1])),
  })
}

const isSaltOwned = (parent: string): boolean => saltOf(parent) !== null

const isFileUrl = (url: string): boolean => url.startsWith('file:')

const isRunModule = (parent: string): boolean =>
  Boolean.or(withinAnySandbox(parent), Boolean.or(isSaltOwned(parent), interceptionStateOf().runModules.has(parent)))

const recordRunModule = (resolved: ResolveFnOutput, parent: string): void => {
  if (Boolean.and(isFileUrl(resolved.url), isRunModule(parent))) {
    interceptionStateOf().runModules.add(resolved.url)
  }
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

interface ProjectForBag {
  readonly projectFor: (file: string) => { readonly root?: string | undefined }
}

const projectBag = (): ProjectForBag | undefined =>
  interceptionStateOf().runtime?.host.state.read<ProjectForBag>(VM_VITEST_BAG_KEY)

const rootFromProject = (projectFor: ProjectForBag['projectFor'], parent: string): string | undefined =>
  Result.match(
    Result.try({
      try: () => projectFor(nodeUrl.fileURLToPath(stripSaltQuery(parent))).root,
      catch: () => undefined,
    }),
    { onFailure: () => undefined, onSuccess: (root) => root },
  )

const projectRootFor = (parent: string): string | undefined =>
  Match.value(projectBag()).pipe(
    Match.when(Match.undefined, () => undefined),
    Match.orElse((bag) => rootFromProject(bag.projectFor, parent)),
  )

const activeSandboxOf = (sandbox: ActiveSandbox | undefined, parent: string): ActiveSandbox | undefined =>
  Option.getOrUndefined(Option.filter(Option.fromNullishOr(sandbox), (active) => withinSandbox(active, parent)))

const isRootedPath = (bare: string): boolean => bare.startsWith('/') && !bare.startsWith('//')

const rootForViteFile = (parent: string, sandbox: ActiveSandbox): string =>
  projectRootFor(parent) ?? nodeUrl.fileURLToPath(sandbox.prefix)

const servedViteFileUrl = (bare: string, query: string, parent: string, sandbox: ActiveSandbox): string =>
  Match.value(nodeFileSystem.existsSync(bare)).pipe(
    Match.when(true, () => `${nodeUrl.pathToFileURL(bare).href}${query}`),
    Match.when(
      false,
      () =>
        `${nodeUrl.pathToFileURL(rootForViteFile(parent, sandbox)).href.replace(/\/?$/, '/')}${bare.slice(1)}${query}`,
    ),
    Match.exhaustive,
  )

const rootedViteFileUrl = (bare: string, query: string, parent: string, sandbox: ActiveSandbox): string | undefined =>
  Match.value(isRootedPath(bare)).pipe(
    Match.when(true, () => servedViteFileUrl(bare, query, parent, sandbox)),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )

const sandboxedViteUrl = (specifier: string, parent: string, sandbox: ActiveSandbox): string | undefined => {
  const { bare, query } = splitQueryOf(specifier)
  return Match.value(bare.startsWith(FS_PREFIX)).pipe(
    Match.when(true, () => `${nodeUrl.pathToFileURL(`/${bare.slice(FS_PREFIX.length)}`).href}${query}`),
    Match.when(false, () => rootedViteFileUrl(bare, query, parent, sandbox)),
    Match.exhaustive,
  )
}

const viteFileUrlOf = (
  specifier: string,
  parent: string,
  sandbox: ActiveSandbox | undefined,
): string | undefined =>
  Match.value(activeSandboxOf(sandbox, parent)).pipe(
    Match.when(Match.undefined, () => undefined),
    Match.orElse((active) => sandboxedViteUrl(specifier, parent, active)),
  )

const scopedPackageNameOf = (specifier: string): string | undefined => {
  const [scope, name] = specifier.split('/')
  return Option.getOrUndefined(
    Option.flatMap(
      Option.fromUndefinedOr(scope),
      (presentScope) => Option.map(Option.fromUndefinedOr(name), (presentName) => `${presentScope}/${presentName}`),
    ),
  )
}

const packageNameOfSpecifier = (specifier: string): string | undefined =>
  Match.value(specifier.startsWith(SCOPED_PACKAGE_PREFIX)).pipe(
    Match.when(true, () => scopedPackageNameOf(specifier)),
    Match.when(false, () => specifier.split('/')[0]),
    Match.exhaustive,
  )

const realpathOrUndefined = (path: string): string | undefined =>
  Result.match(
    Result.try({
      try: () => nodeFileSystem.realpathSync(path),
      catch: () => undefined,
    }),
    { onFailure: () => undefined, onSuccess: (real) => real },
  )

const packageNameWithScope = (name: string, scopeChild: string | undefined): Option.Option<string> =>
  Match.value(name.startsWith(SCOPED_PACKAGE_PREFIX)).pipe(
    Match.when(true, () => Option.map(Option.fromUndefinedOr(scopeChild), (child) => `${name}/${child}`)),
    Match.when(false, () => Option.some(name)),
    Match.exhaustive,
  )

const packageNameUnderOwner = (segments: ReadonlyArray<string>, owner: number): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.fromUndefinedOr(segments[owner + 1]),
      (name) => packageNameWithScope(name, segments[owner + 2]),
    ),
  )

const packageNameInSegments = (segments: ReadonlyArray<string>): string | undefined =>
  Match.value(segments.lastIndexOf(NODE_MODULES_DIRECTORY)).pipe(
    Match.when(-1, () => undefined),
    Match.orElse((owner) => packageNameUnderOwner(segments, owner)),
  )

const packageNameOfFileUrl = (fileUrl: string): string | undefined => {
  const real = realpathOrUndefined(nodeUrl.fileURLToPath(splitQueryOf(fileUrl).bare))
  return real === undefined ? undefined : packageNameInSegments(real.split('/'))
}

const servedSpecifierOf = (packageName: string): string | undefined =>
  SERVED_SPECIFIERS.find((specifier) => packageNameOfSpecifier(specifier) === packageName)

const harnessUrlForResolvedFile = (fileUrl: string): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromUndefinedOr(packageNameOfFileUrl(fileUrl)), (candidate) =>
      Option.map(Option.fromUndefinedOr(servedSpecifierOf(candidate)), (served) =>
        harnessUrlForSpecifier(served))),
  )

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
  const runtime = interceptionStateOf().runtime
  return runtime === undefined
    ? nativeResolve(specifier, context)
    : runResolveStage(runtime.plugins, runtime.host, specifier, context, nativeResolve)
}

const relativeSpecifier = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/')

const hostResolvedOutput = (
  specifier: string,
  scoped: Partial<ResolveHookContext>,
  cause: AnyDecoded,
  nextResolve: VmResolveTerminal,
  sandbox: ActiveSandbox,
): ResolveFnOutput =>
  Match.value(interceptionStateOf().runtime?.host).pipe(
    Match.when(Match.undefined, () => {
      throw cause
    }),
    Match.orElse((host) => nextResolve(new URL(host.resolveVitestModule(specifier), sandbox.prefix).href, scoped)),
  )

const harnessResolutionOf = (
  specifier: string,
  scoped: Partial<ResolveHookContext>,
  cause: AnyDecoded,
  nextResolve: VmResolveTerminal,
  sandbox: ActiveSandbox,
): ResolveFnOutput =>
  Match.value(relativeSpecifier(specifier)).pipe(
    Match.when(true, () => {
      throw cause
    }),
    Match.when(false, () => hostResolvedOutput(specifier, scoped, cause, nextResolve, sandbox)),
    Match.exhaustive,
  )

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
    onFailure: (cause) => harnessResolutionOf(specifier, scoped, cause, nextResolve, sandbox),
  })
}

const scopedHarnessUrl = (
  specifier: string,
  parent: string,
  sandbox: ActiveSandbox | undefined,
): Option.Option<string> =>
  Option.flatMap(
    Option.filter(Option.fromNullishOr(sandbox), () => isRunModule(parent)),
    () =>
      Option.map(
        Option.fromNullishOr(harnessUrlForSpecifier(specifier)),
        (url) => withSalt(url, saltOf(parent)),
      ),
  )

const resolveMappedFile = (
  mapped: string,
  context: ResolveHookContext,
  parent: string,
  nativeResolve: VmResolveTerminal,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput =>
  Option.match(Option.fromNullishOr(harnessUrlForResolvedFile(mapped)), {
    onNone: () =>
      parentSaltScoped(
        resolveThroughPlugins(splitQueryOf(mapped).bare, { ...context, parentURL: parent }, nativeResolve),
        parent,
        sandbox,
      ),
    onSome: (served) => ({ url: withSalt(served, saltOf(parent)), shortCircuit: true }),
  })

const resolveDelegated = (
  specifier: string,
  context: ResolveHookContext,
  nextResolve: VmResolveTerminal,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput => {
  const parent = parentUrlOf(context)
  const nativeResolve = nativeResolveOf(sandbox, nextResolve)
  return Option.match(Option.fromNullishOr(viteFileUrlOf(specifier, parent, sandbox)), {
    onNone: () => parentSaltScoped(resolveThroughPlugins(specifier, context, nativeResolve), parent, sandbox),
    onSome: (mapped) => resolveMappedFile(mapped, context, parent, nativeResolve, sandbox),
  })
}

const resolveHarnessSpecifier = (
  specifier: string,
  context: ResolveHookContext,
  nextResolve: VmResolveTerminal,
  sandbox: ActiveSandbox | undefined,
  parent: string,
): ResolveFnOutput =>
  Match.value(specifier.startsWith(HARNESS_PREFIX)).pipe(
    Match.when(true, () => ({ url: specifier, shortCircuit: true })),
    Match.when(false, () =>
      Option.match(scopedHarnessUrl(specifier, parent, sandbox), {
        onNone: () => resolveDelegated(specifier, context, nextResolve, sandbox),
        onSome: (url) => ({ url, shortCircuit: true }),
      })),
    Match.exhaustive,
  )

const resolveWithin: ResolveHookSync = (specifier, context, nextResolve) => {
  const parent = parentUrlOf(context)
  const sandbox = activeSandbox()
  const resolved = Match.value(parent.startsWith(HARNESS_PREFIX)).pipe(
    Match.when(true, () => resolveFromHarness(specifier, context, nextResolve, sandbox)),
    Match.when(false, () => resolveHarnessSpecifier(specifier, context, nextResolve, sandbox, parent)),
    Match.exhaustive,
  )
  recordRunModule(resolved, parent)
  return resolved
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

type SaltedModuleLoad = LoadFnOutput & {
  readonly format: string
  readonly source: NonNullable<LoadFnOutput['source']>
}

const formatTextOf = (format: LoadFnOutput['format']): string | undefined =>
  typeof format === 'string' ? format : undefined

const moduleFormatOf = (format: LoadFnOutput['format']): Option.Option<string> =>
  Option.filter(Option.fromUndefinedOr(formatTextOf(format)), (text) => text.startsWith('module'))

const moduleLoadOptionsOf = (
  loaded: LoadFnOutput,
): Option.Option<{ readonly format: string; readonly source: NonNullable<LoadFnOutput['source']> }> =>
  Option.flatMap(
    moduleFormatOf(loaded.format),
    (format) => Option.map(Option.fromUndefinedOr(loaded.source), (source) => ({ format, source })),
  )

const isSaltedModuleLoad = (loaded: LoadFnOutput): loaded is SaltedModuleLoad =>
  Option.isSome(moduleLoadOptionsOf(loaded))

const moduleLoadOf = (loaded: LoadFnOutput): LoadFnOutput =>
  isSaltedModuleLoad(loaded) ? { format: loaded.format, source: loaded.source, shortCircuit: true } : loaded

const saltedLoadTerminalOf = (nextLoad: VmLoadTerminal): VmLoadTerminal => (url, context) =>
  Boolean.match(url.startsWith('file:') && saltOf(url) !== null, {
    onTrue: () => moduleLoadOf(nextLoad(stripSaltQuery(url), context)),
    onFalse: () => nextLoad(url, context),
  })

const loadThroughPlugins = (
  url: string,
  context: LoadHookContext,
  nextLoad: VmLoadTerminal,
): LoadFnOutput =>
  Match.value(interceptionStateOf().runtime).pipe(
    Match.when(Match.undefined, () => nextLoad(url, context)),
    Match.orElse((runtime) =>
      runLoadStage(runtime.plugins, runtime.host, url, context, saltedLoadTerminalOf(nextLoad))
    ),
  )

const loadWithin: LoadHookSync = (url, context, nextLoad) =>
  Match.value(harnessModuleSource(url)).pipe(
    Match.when(Match.undefined, () => loadThroughPlugins(url, context, nextLoad)),
    Match.orElse((source) => ({ format: 'module', source, shortCircuit: true })),
  )

const sandboxGate = Semaphore.makeUnsafe(1)

const installInterceptionCell: Cell.Cell<InstallInterceptionCommand, void> = Cell.mapInput(
  Cell.fromEffect(Effect.void),
  (command: InstallInterceptionCommand) => {
    if (!interceptionStateOf().installed) {
      interceptionStateOf().hooks = command.nodeModule.registerHooks({ resolve: resolveWithin, load: loadWithin })
      interceptionStateOf().installed = true
      interceptionStateOf().runModules.clear()
    }
    interceptionStateOf().runtime = command.runtime
    return undefined
  },
)

const uninstallInterceptionCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionStateOf().hooks?.deregister()
    interceptionStateOf().hooks = undefined
    interceptionStateOf().installed = false
    interceptionStateOf().runModules.clear()
  }),
)

const activateSandboxCell: Cell.Cell<ActivateSandboxCommand, void> = Cell.mapInput(
  Cell.fromEffect(Effect.void),
  (command: ActivateSandboxCommand) => {
    Effect.runSync(
      Effect.sync(() => {
        interceptionStateOf().activeSandboxes.push({ prefix: command.prefix })
      }).pipe(sandboxGate.withPermits(1)),
    )
    return undefined
  },
)

const deactivateSandboxCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionStateOf().activeSandboxes.pop()
  }),
)

export const installInterception = dual<
  (runtime: InterceptionRuntime) => (nodeModule: HarnessModuleBuiltin) => void,
  (nodeModule: HarnessModuleBuiltin, runtime: InterceptionRuntime) => void
>(2, (nodeModule, runtime) => {
  Effect.runSync(installInterceptionCell.run({ nodeModule, runtime }))
})

export const uninstallInterception = (): void => {
  Effect.runSync(uninstallInterceptionCell.run(undefined))
  interceptionStateOf().runtime = undefined
}

export const activateSandbox = (prefix: string): void => {
  Effect.runSync(activateSandboxCell.run({ prefix }))
}

export const deactivateSandbox = (): void => {
  Effect.runSync(deactivateSandboxCell.run(undefined))
}
