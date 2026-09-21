const unsupportedSnapshot = (): never => {
  throw new Error(
    "Snapshot assertions (toMatchSnapshot, toMatchInlineSnapshot) are not supported by the in-memory 'vm' runner. Use testRunner: 'vitest' for suites that need snapshots.",
  )
}

const unsupportedMocking = (name: string): never => {
  throw new Error(
    `vi.${name} is not supported by the in-memory 'vm' runner. Use testRunner: 'vitest' for suites that need module mocking.`,
  )
}

export const guardedExpect = (real: object): unknown =>
  new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'toMatchSnapshot' || property === 'toMatchInlineSnapshot') {
        return unsupportedSnapshot
      }
      return Reflect.get(target, property, receiver)
    },
  })

export const guardedVi = (real: object): unknown =>
  new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'mock' || property === 'hoisted') {
        return () => unsupportedMocking(String(property))
      }
      return Reflect.get(target, property, receiver)
    },
  })
