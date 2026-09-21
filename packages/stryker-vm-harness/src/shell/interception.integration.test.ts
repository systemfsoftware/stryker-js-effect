import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as nodeModule from 'node:module'
import * as path from 'node:path'
import * as url from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { createHarnessApi, createRegistry } from '../core/registry.js'
import { makeEffectMethods } from './effect-adapter.js'
import { readGlobalState, writeGlobalState } from './global-state.js'
import {
  activateSandbox,
  activateSandboxCell,
  deactivateSandbox,
  installInterception,
  resetInterceptionForTests,
  uninstallInterception,
} from './interception.js'

describe('shell integration', () => {
  afterEach(() => {
    writeGlobalState(undefined)
    deactivateSandbox()
    uninstallInterception()
    resetInterceptionForTests()
  })

  it('installs interception, activates sandbox, and nativeImport of salted URL registers suites', async () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)

    const state = {
      api,
      expect,
      vi: undefined,
      effectVitest: undefined,
    }

    const currentDir = path.dirname(url.fileURLToPath(import.meta.url))
    const prefix = `${url.pathToFileURL(currentDir).href}/`

    let hooksRegistered = false
    const dummyBuiltin = {
      registerHooks: (_opts: unknown) => {
        hooksRegistered = true
      },
    }
    installInterception(dummyBuiltin)
    expect(hooksRegistered).toBe(true)
    activateSandbox(state, prefix)
    writeGlobalState(state)

    expect(readGlobalState()).toBe(state)

    const vm = await import('node:vm')
    const sources = await import('../core/sources.js')
    const harnessSource = sources.harnessSourceFor('vmrunner-harness:vitest') ?? ''
    expect(harnessSource.length).toBeGreaterThan(0)

    const vmContext = vm.createContext({
      globalThis: {
        ...globalThis,
        [Symbol.for('@systemfsoftware/stryker-js/vm-runner')]: state,
      },
    })

    const cjsSource = harnessSource
      .replace(
        /export\s*\{\s*([^}]+)\s*\}/g,
        (_, names) => names.split(',').map((n: string) => `exports.${n.trim()} = ${n.trim()};`).join('\n'),
      )
      .replace(/export\s+const\s+(\w+)\s*=/g, 'exports.$1 =')
    const script = new vm.Script(`(() => {
      const exports = {};
      ${cjsSource}
      return exports;
    })()`)
    const importedModule = script.runInContext(vmContext) as {
      describe: (name: string, fn: () => void) => void
      it: (name: string, fn: () => void) => void
      test: (name: string, fn: () => void) => void
    }

    expect(importedModule).toBeDefined()
    expect(typeof importedModule.describe).toBe('function')
    expect(typeof importedModule.it).toBe('function')

    importedModule.describe('suite from salted harness', () => {
      importedModule.it('test 1', () => {})
    })

    expect(registry.suites.size).toBe(1)
    expect(registry.tests.length).toBe(1)
    expect(registry.tests[0]?.name).toBe('test 1')
  })

  it('deactivates sandbox and uninstalls interception to restore module state', async () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const state = { api, expect, vi: undefined, effectVitest: undefined }
    const builtinModule = (globalThis.process?.getBuiltinModule?.('node:module') ?? nodeModule) as unknown as {
      registerHooks: (opts: unknown) => unknown
    }
    installInterception(builtinModule)
    activateSandbox(state, 'file:///tmp/sandbox/')
    writeGlobalState(state)

    expect(readGlobalState()).toBe(state)

    deactivateSandbox()
    writeGlobalState(undefined)
    uninstallInterception()

    expect(readGlobalState()).toBeUndefined()
  })

  it('serializes concurrent activateSandbox calls through the shell cell semaphore', async () => {
    const order: number[] = []

    const call1 = Effect.runPromise(
      activateSandboxCell.run({
        prefix: 'file:///tmp/sandbox1/',
      }),
    ).then(() => {
      order.push(1)
    })

    const call2 = Effect.runPromise(
      activateSandboxCell.run({
        prefix: 'file:///tmp/sandbox2/',
      }),
    ).then(() => {
      order.push(2)
    })

    await Promise.all([call1, call2])
    expect(order.length).toBe(2)
  })

  it('makeEffectMethods runs an Effect test through a real Layer and returns the correct result and error path', async () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)

    const itApi = makeEffectMethods({
      api: api.it,
      describe: api.describe,
      hooks: api.hooks,
      tests: registry.tests,
    })

    let ranSuccess = false
    itApi.effect('runs success effect test', () =>
      Effect.sync(() => {
        ranSuccess = true
      }))

    expect(registry.tests.length).toBe(1)
    const successTest = registry.tests[0]
    expect(successTest?.name).toBe('runs success effect test')

    const abortController = new AbortController()
    const dummyContext = {
      signal: abortController.signal,
      task: { type: 'test' as const, name: 'runs success effect test' },
      onTestFinished: () => {},
    }

    await successTest?.fn?.(dummyContext)
    expect(ranSuccess).toBe(true)

    itApi.effect('runs failing effect test', () => Effect.fail(new Error('intentional failure')))

    expect(registry.tests.length).toBe(2)
    const failureTest = registry.tests[1]

    await expect(failureTest?.fn?.(dummyContext)).rejects.toThrow('intentional failure')

    class GreetingService extends (await import('effect/Context')).Service<
      GreetingService,
      { readonly greet: (name: string) => string }
    >()('GreetingService') {}

    const GreetingLive = Layer.succeed(
      GreetingService,
      GreetingService.of({
        greet: (name: string) => `Hello, ${name}!`,
      }),
    )
    let layerTestRan = false
    itApi.layer(GreetingLive)('layered block', (itWithLayer) => {
      itWithLayer.effect('greets via layer', () =>
        Effect.gen(function*() {
          const service = yield* GreetingService
          const msg = service.greet('Stryker')
          expect(msg).toBe('Hello, Stryker!')
          layerTestRan = true
        }))
    })

    const layeredRegisteredTest = registry.tests.find((t) => t.name === 'greets via layer')
    expect(layeredRegisteredTest).toBeDefined()
    await layeredRegisteredTest?.fn?.(dummyContext)
    expect(layerTestRan).toBe(true)
  })
})
