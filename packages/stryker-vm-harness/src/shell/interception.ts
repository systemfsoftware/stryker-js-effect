import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'
import type { LoadHookSync, RegisterHooksOptions, ResolveFnOutput, ResolveHookSync } from 'node:module'

import {
  EFFECT_VITEST_HARNESS_URL,
  GHERKIN_HARNESS_URL,
  harnessSourceFor,
  harnessUrlForSpecifier,
  VITEST_HARNESS_URL,
} from '../core/sources.js'
import type { VmRunnerGlobalState } from './global-state.js'

export type RegisterHooksFn = (hooks: RegisterHooksOptions) => unknown

export interface HarnessModuleBuiltin {
  readonly registerHooks: RegisterHooksFn
}

interface ActiveSandbox {
  readonly prefix: string
}

interface InterceptionState {
  readonly activeSandboxes: ActiveSandbox[]
  installed: boolean
  installCount: number
}

const interceptionState: InterceptionState = {
  activeSandboxes: [],
  installed: false,
  installCount: 0,
}

const activeSandbox = (): ActiveSandbox | undefined =>
  interceptionState.activeSandboxes[interceptionState.activeSandboxes.length - 1]

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

  if (specifier.startsWith('vmrunner-harness:')) {
    return { url: specifier, shortCircuit: true }
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

const sandboxGate = Semaphore.makeUnsafe(1)

export interface ActivateSandboxCommand {
  readonly state?: VmRunnerGlobalState | undefined
  readonly prefix: string
}

export const installInterceptionCell: Cell.Cell<HarnessModuleBuiltin, void> = Cell.fromEffect(Effect.void).pipe(
  Cell.mapInput((nodeModule: HarnessModuleBuiltin) => {
    interceptionState.installCount += 1
    if (!interceptionState.installed) {
      nodeModule.registerHooks({ resolve: resolveWithin, load: loadWithin })
      interceptionState.installed = true
    }
    return undefined
  }),
)

export const uninstallInterceptionCell: Cell.Cell<void, void> = Cell.fromEffect(
  Effect.sync(() => {
    interceptionState.installCount = Math.max(0, interceptionState.installCount - 1)
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

export const installInterception = (nodeModule: HarnessModuleBuiltin): void => {
  Effect.runSync(installInterceptionCell.run(nodeModule))
}

export const uninstallInterception = (): void => {
  Effect.runSync(uninstallInterceptionCell.run(undefined))
}

export const activateSandbox = (state: VmRunnerGlobalState, prefix: string): void => {
  Effect.runSync(activateSandboxCell.run({ state, prefix }))
}

export const deactivateSandbox = (): void => {
  Effect.runSync(deactivateSandboxCell.run(undefined))
}

export const resetInterceptionForTests = (): void => {
  interceptionState.activeSandboxes.length = 0
  interceptionState.installCount = 0
}

export const HARNESS_URLS = [VITEST_HARNESS_URL, EFFECT_VITEST_HARNESS_URL, GHERKIN_HARNESS_URL] as const
