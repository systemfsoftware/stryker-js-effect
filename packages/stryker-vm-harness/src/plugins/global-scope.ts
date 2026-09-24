import { STATE_KEY } from '../harness-sources.handle.js'
import type { VmSessionPlugin } from '../session-plugin.js'

const MANAGED_GLOBAL = /^__(?:stryker|vitest)/

const isManagedKey = (key: string | symbol): boolean =>
  typeof key === 'string' ? MANAGED_GLOBAL.test(key) : key === STATE_KEY

const ownKeysOf = (): ReadonlySet<string | symbol> =>
  new Set(Reflect.ownKeys(globalThis).filter((key) => !isManagedKey(key)))

const addedKeysSince = (snapshot: ReadonlySet<string | symbol>): ReadonlyArray<string | symbol> =>
  Reflect.ownKeys(globalThis).filter((key) => !snapshot.has(key) && !isManagedKey(key))

const removeKeys = (keys: ReadonlyArray<string | symbol>): void => {
  for (const key of keys) {
    Reflect.deleteProperty(globalThis, key)
  }
}

export const createGlobalScopePlugin = (): VmSessionPlugin => {
  let beforeRun: ReadonlySet<string | symbol> = ownKeysOf()

  return {
    name: 'global-scope',
    beforeFileRun: () => {
      beforeRun = ownKeysOf()
    },
    afterFileRun: () => {
      removeKeys(addedKeysSince(beforeRun))
    },
  }
}
