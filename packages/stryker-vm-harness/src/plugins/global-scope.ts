import { STATE_KEY } from '../harness-sources.handle.js'
import type { VmSessionPlugin } from '../session-plugin.js'

const MANAGED_GLOBAL = /^__(?:stryker|vitest)/

const isManagedKey = (key: string | symbol): boolean =>
  typeof key === 'string' ? MANAGED_GLOBAL.test(key) : key === STATE_KEY

const ownKeysOf = (): ReadonlySet<string | symbol> => {
  const keys = new Set<string | symbol>()
  for (const key of Reflect.ownKeys(globalThis)) {
    if (!isManagedKey(key)) {
      keys.add(key)
    }
  }
  return keys
}

const addedKeysSince = (snapshot: ReadonlySet<string | symbol>): ReadonlyArray<string | symbol> => {
  const added: Array<string | symbol> = []
  for (const key of Reflect.ownKeys(globalThis)) {
    if (!snapshot.has(key) && !isManagedKey(key)) {
      added.push(key)
    }
  }
  return added
}

const removeKeys = (keys: ReadonlyArray<string | symbol>): void => {
  for (const key of keys) {
    Reflect.deleteProperty(globalThis, key)
  }
}

export const createGlobalScopePlugin = (): VmSessionPlugin => {
  let beforeRun: ReadonlySet<string | symbol> = ownKeysOf()
  let ranKeys: ReadonlyArray<string | symbol> = []

  return {
    name: 'global-scope',
    beforeFileRun: () => {
      beforeRun = ownKeysOf()
    },
    afterFileRun: () => {
      ranKeys = addedKeysSince(beforeRun)
      removeKeys(ranKeys)
      ranKeys = []
    },
  }
}
