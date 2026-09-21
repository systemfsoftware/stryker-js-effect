import * as Match from 'effect/Match'

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

const isSnapshotProp = (property: PropertyKey): boolean =>
  property === 'toMatchSnapshot' || property === 'toMatchInlineSnapshot'

const isMockProp = (property: PropertyKey): boolean => property === 'mock' || property === 'hoisted'

export const guardedExpect = (real: object): object =>
  new Proxy(real, {
    get(target, property, receiver): unknown {
      return Match.value(isSnapshotProp(property)).pipe(
        Match.when(true, () => unsupportedSnapshot),
        Match.when(false, () => Reflect.get(target, property, receiver)),
        Match.exhaustive,
      )
    },
  })

export const guardedVi = (real: object): object =>
  new Proxy(real, {
    get(target, property, receiver): unknown {
      return Match.value(isMockProp(property)).pipe(
        Match.when(true, () => () => unsupportedMocking(String(property))),
        Match.when(false, () => Reflect.get(target, property, receiver)),
        Match.exhaustive,
      )
    },
  })
