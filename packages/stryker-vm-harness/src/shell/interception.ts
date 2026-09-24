import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'
import type { LoadFnOutput, LoadHookSync, RegisterHooksOptions, ResolveFnOutput, ResolveHookSync } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  EFFECT_VITEST_HARNESS_URL,
  GHERKIN_HARNESS_URL,
  harnessSourceFor,
  harnessUrlForSpecifier,
  VITEST_HARNESS_URL,
} from '../core/sources.js'
import {
  runLoadStage,
  runResolveStage,
  type VmLoadTerminal,
  type VmPluginHost,
  type VmResolveTerminal,
  type VmSessionPlugin,
} from './session-plugin.js'
import { VM_VITEST_BAG_KEY } from './vitest-host/runtime.js'

export type RegisterHooksFn = (
  hooks: RegisterHooksOptions,
) => { readonly deregister: () => void } | undefined

export interface HarnessModuleBuiltin {
  readonly registerHooks: RegisterHooksFn
}

export interface InterceptionRuntime {
  readonly host: VmPluginHost
  readonly plugins: readonly VmSessionPlugin[]
}

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

const isSandboxFile = (url: string | undefined, prefix: string): boolean => url !== undefined && url.startsWith(prefix)

const SALT_QUERY = /[?&]salt=([^&#]*)/

const saltOf = (url: string | undefined): string | null => {
  const match = url === undefined ? null : SALT_QUERY.exec(url)
  return match === null ? null : (match[1] ?? null)
}

const withParentSalt = (
  resolved: ResolveFnOutput,
  parent: string,
  sandbox: ActiveSandbox | undefined,
): ResolveFnOutput => {
  const salt = saltOf(parent)
  if (
    salt === null ||
    sandbox === undefined ||
    !resolved.url.startsWith(sandbox.prefix) ||
    saltOf(resolved.url) !== null
  ) {
    return resolved
  }
  const sep = resolved.url.includes('?') ? '&' : '?'
  return { ...resolved, url: `${resolved.url}${sep}salt=${salt}`, shortCircuit: true }
}
const FS_PREFIX = '/@fs/'

const SERVED_SPECIFIERS: ReadonlyArray<string> = ['vitest', '@effect/vitest', '@systemfsoftware/effect-gherkin-spec']

const splitQueryOf = (specifier: string): { readonly bare: string; readonly query: string } => {
  const queryAt = specifier.indexOf('?')
  return queryAt === -1
    ? { bare: specifier, query: '' }
    : { bare: specifier.slice(0, queryAt), query: specifier.slice(queryAt) }
}

const projectRootFor = (parent: string): string | undefined => {
  const runtime = interceptionState.runtime?.host.state.read<
    { readonly projectFor: (file: string) => { readonly root?: string } }
  >(
    VM_VITEST_BAG_KEY,
  )
  const projectFor = runtime?.projectFor
  if (projectFor === undefined) {
    return undefined
  }
  try {
    return projectFor(fileURLToPath(stripSaltQuery(parent))).root
  } catch {
    return undefined
  }
}

const viteFileUrlOf = (specifier: string, parent: string, sandbox: ActiveSandbox | undefined): string | undefined => {
  if (sandbox === undefined || !isSandboxFile(parent, sandbox.prefix)) {
    return undefined
  }
  const { bare, query } = splitQueryOf(specifier)
  if (bare.startsWith(FS_PREFIX)) {
    const absolute = `/${bare.slice(FS_PREFIX.length)}`
    if (!absolute.startsWith('/')) {
      return undefined
    }
    return `${pathToFileURL(absolute).href}${query}`
  }
  if (bare.startsWith('/') && !bare.startsWith('//')) {
    if (globalThis.process.getBuiltinModule('node:fs').existsSync(bare)) {
      return `${pathToFileURL(bare).href}${query}`
    }
    const root = projectRootFor(parent) ?? fileURLToPath(sandbox.prefix)
    return `${pathToFileURL(root).href.replace(/\/?$/, '/')}${bare.slice(1)}${query}`
  }
  return undefined
}

const packageNameOfSpecifier = (specifier: string): string | undefined => {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  }
  return specifier.split('/')[0]
}

const packageNameOfFileUrl = (fileUrl: string): string | undefined => {
  let path: string
  try {
    path = globalThis.process.getBuiltinModule('node:fs').realpathSync(
      fileURLToPath(splitQueryOf(fileUrl).bare),
    )
  } catch {
    return undefined
  }
  const segments = path.split('/')
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
  for (const specifier of SERVED_SPECIFIERS) {
    if (packageNameOfSpecifier(specifier) === candidate) {
      return harnessUrlForSpecifier(specifier)
    }
  }
  return undefined
}
const resolveWithin: ResolveHookSync = (specifier, context, nextResolve) => {
  const parent = context.parentURL ?? ''
  const sandbox = activeSandbox()

  if (parent.startsWith('vmrunner-harness:')) {
    if (sandbox === undefined) {
      throw new Error(`No in-memory runner is active; cannot resolve "${specifier}" for a harness module.`)
    }
    try {
      return nextResolve(specifier, { ...context, parentURL: sandbox.prefix })
    } catch (cause) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        throw cause
      }
      const host = interceptionState.runtime?.host
      if (host === undefined) {
        throw cause
      }
      const resolved = host.resolveVitestModule(specifier)
      return nextResolve(new URL(resolved, sandbox.prefix).href, { ...context, parentURL: sandbox.prefix })
    }
  }

  if (specifier.startsWith('vmrunner-harness:')) {
    return { url: specifier, shortCircuit: true }
  }
  const harnessUrl = harnessUrlForSpecifier(specifier)
  if (harnessUrl !== undefined && sandbox !== undefined && isSandboxFile(parent, sandbox.prefix)) {
    const salt = saltOf(parent)
    const scoped = salt === null ? harnessUrl : `${harnessUrl}?salt=${salt}`
    return { url: scoped, shortCircuit: true }
  }
  const nativeResolve: VmResolveTerminal = (nativeSpecifier, nativeContext) => {
    try {
      return nextResolve(nativeSpecifier, nativeContext)
    } catch (cause) {
      const nativeParent = nativeContext?.parentURL ?? ''
      if (sandbox !== undefined && isSandboxFile(nativeParent, sandbox.prefix) && nativeSpecifier.endsWith('.js')) {
        return nextResolve(`${nativeSpecifier.slice(0, -3)}.ts`, nativeContext)
      }
      throw cause
    }
  }
  const runtime = interceptionState.runtime
  const viteMapped = viteFileUrlOf(specifier, parent, sandbox)
  if (viteMapped !== undefined) {
    const served = harnessUrlForResolvedFile(viteMapped)
    if (served !== undefined) {
      const salt = saltOf(parent)
      return { url: salt === null ? served : `${served}?salt=${salt}`, shortCircuit: true }
    }
    const mappedSpecifier = splitQueryOf(viteMapped).bare
    const mapped = runtime === undefined
      ? nativeResolve(mappedSpecifier, { ...context, parentURL: parent })
      : runResolveStage(
        runtime.plugins,
        runtime.host,
        mappedSpecifier,
        { ...context, parentURL: parent },
        nativeResolve,
      )
    return withParentSalt(mapped, parent, sandbox)
  }
  const resolved = runtime === undefined
    ? nativeResolve(specifier, context)
    : runResolveStage(runtime.plugins, runtime.host, specifier, context, nativeResolve)
  return withParentSalt(resolved, parent, sandbox)
}

const stripSaltQuery = (url: string): string => {
  const stripped = url.replace(/[?&]salt=[^&#]*/, '')
  return stripped.endsWith('?') ? stripped.slice(0, -1) : stripped
}

type LoadTerminalContinuation = (
  url: Parameters<LoadHookSync>[0],
  context?: Partial<Parameters<LoadHookSync>[1]>,
) => LoadFnOutput

const loadTerminalContinuationOf = (nextLoad: LoadHookSync): LoadTerminalContinuation =>
  nextLoad as LoadTerminalContinuation

const saltedLoadTerminalOf = (nextLoad: LoadHookSync): VmLoadTerminal => {
  const load = loadTerminalContinuationOf(nextLoad)
  return (url, context) => {
    if (!url.startsWith('file:') || saltOf(url) === null) {
      return load(url, context)
    }
    const loaded = load(stripSaltQuery(url), context)
    if (loaded.source === undefined || typeof loaded.format !== 'string' || !loaded.format.startsWith('module')) {
      return loaded
    }
    return { format: loaded.format, source: loaded.source, shortCircuit: true }
  }
}

const loadWithin: LoadHookSync = (url, context, nextLoad) => {
  const queryAt = url.indexOf('?')
  if (queryAt !== -1 && url.startsWith('vmrunner-harness:')) {
    const base = url.slice(0, queryAt)
    const source = harnessSourceFor(base)
    if (source !== undefined) {
      return { format: 'module', source, shortCircuit: true }
    }
  }
  if (url.startsWith('vmrunner-harness:')) {
    const source = harnessSourceFor(url)
    if (source !== undefined) {
      return { format: 'module', source, shortCircuit: true }
    }
  }
  const runtime = interceptionState.runtime
  return runtime === undefined
    ? nextLoad(url, context)
    : runLoadStage(runtime.plugins, runtime.host, url, context, saltedLoadTerminalOf(nextLoad))
}

const sandboxGate = Semaphore.makeUnsafe(1)

export interface ActivateSandboxCommand {
  readonly prefix: string
}

export interface InstallInterceptionCommand {
  readonly nodeModule: HarnessModuleBuiltin
  readonly runtime: InterceptionRuntime
}

export const installInterceptionCell: Cell.Cell<InstallInterceptionCommand, void> = Cell.mapInput(
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
      sandboxGate.withPermits(1)(
        Effect.sync(() => {
          interceptionState.activeSandboxes.push({ prefix: command.prefix })
        }),
      ),
    )
    return undefined
  },
)

export const deactivateSandboxCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionState.activeSandboxes.pop()
  }),
)

export const installInterception = (nodeModule: HarnessModuleBuiltin, runtime: InterceptionRuntime): void => {
  Effect.runSync(
    installInterceptionCell.run({ nodeModule, runtime }),
  )
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

export const resetInterceptionForTests = (): void => {
  interceptionState.hooks?.deregister()
  interceptionState.hooks = undefined
  interceptionState.installed = false
  interceptionState.runtime = undefined
  interceptionState.activeSandboxes.length = 0
}

export const HARNESS_URLS = [VITEST_HARNESS_URL, EFFECT_VITEST_HARNESS_URL, GHERKIN_HARNESS_URL] as const
