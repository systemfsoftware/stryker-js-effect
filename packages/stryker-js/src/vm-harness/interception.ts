import type { LoadHookSync, RegisterHooksOptions, ResolveFnOutput, ResolveHookSync } from 'node:module'

import type { VmRunnerGlobalState } from './global-state.js'
import {
  EFFECT_VITEST_HARNESS_URL,
  GHERKIN_HARNESS_URL,
  harnessSourceFor,
  harnessUrlForSpecifier,
  VITEST_HARNESS_URL,
} from './sources.js'

export type RegisterHooksFn = (hooks: RegisterHooksOptions) => unknown

export interface HarnessModuleBuiltin {
  readonly registerHooks: RegisterHooksFn
}

interface ActiveSandbox {
  readonly prefix: string
}

const activeSandboxes: ActiveSandbox[] = []

const activeSandbox = (): ActiveSandbox | undefined => activeSandboxes[activeSandboxes.length - 1]

const isSandboxFile = (url: string | undefined, prefix: string): boolean => url !== undefined && url.startsWith(prefix)

const saltOf = (url: string | undefined): string | null => {
  if (url === undefined) {
    return null
  }
  const marker = '?salt='
  const at = url.indexOf(marker)
  return at === -1 ? null : url.slice(at + marker.length)
}

const resolveWithin: ResolveHookSync = (specifier, context, nextResolve) => {
  const parent = context.parentURL ?? ''
  const sandbox = activeSandbox()

  if (parent.startsWith('vmrunner-harness:')) {
    if (sandbox === undefined) {
      throw new Error(`No in-memory runner is active; cannot resolve "${specifier}" for a harness module.`)
    }
    return nextResolve(specifier, { ...context, parentURL: sandbox.prefix })
  }

  const harnessUrl = harnessUrlForSpecifier(specifier)
  if (harnessUrl !== undefined && sandbox !== undefined && isSandboxFile(parent, sandbox.prefix)) {
    const salt = saltOf(parent)
    const scoped = salt === null ? harnessUrl : `${harnessUrl}?salt=${salt}`
    return { url: scoped, shortCircuit: true }
  }

  let resolved: ResolveFnOutput
  try {
    resolved = nextResolve(specifier, context)
  } catch (cause) {
    if (
      sandbox !== undefined &&
      isSandboxFile(parent, sandbox.prefix) &&
      specifier.endsWith('.js')
    ) {
      const tsSpecifier = `${specifier.slice(0, -3)}.ts`
      resolved = nextResolve(tsSpecifier, context)
    } else {
      throw cause
    }
  }
  const salt = saltOf(parent)
  if (
    salt !== null &&
    sandbox !== undefined &&
    resolved.url.startsWith(sandbox.prefix) &&
    !resolved.url.includes('?salt=') &&
    !resolved.url.includes('&salt=')
  ) {
    const sep = resolved.url.includes('?') ? '&' : '?'
    return { url: `${resolved.url}${sep}salt=${salt}`, shortCircuit: true }
  }
  return resolved
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
  return nextLoad(url, context)
}

let installed = false
let installCount = 0

export const installInterception = (nodeModule: HarnessModuleBuiltin): void => {
  installCount += 1
  if (installed) {
    return
  }
  nodeModule.registerHooks({ resolve: resolveWithin, load: loadWithin })
  installed = true
}

export const uninstallInterception = (): void => {
  installCount = Math.max(0, installCount - 1)
}

export const activateSandbox = (state: VmRunnerGlobalState, prefix: string): void => {
  activeSandboxes.push({ prefix })
  void state
}

export const deactivateSandbox = (): void => {
  activeSandboxes.pop()
}

export const resetInterceptionForTests = (): void => {
  activeSandboxes.length = 0
  installCount = 0
}

export const HARNESS_URLS = [VITEST_HARNESS_URL, EFFECT_VITEST_HARNESS_URL, GHERKIN_HARNESS_URL] as const
