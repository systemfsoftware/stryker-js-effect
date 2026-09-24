import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'

type AnyDecoded<A = unknown> = A

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
  Boolean.or(property === 'toMatchSnapshot', property === 'toMatchInlineSnapshot')

const isMockProp = (property: PropertyKey): boolean => Boolean.or(property === 'mock', property === 'hoisted')

const memberOf = (target: object, property: PropertyKey, receiver: AnyDecoded): AnyDecoded => {
  const value: AnyDecoded = Reflect.get(target, property, receiver)
  return value
}

export const guardedExpect = (real: object): object =>
  new Proxy(real, {
    get: (target, property, receiver) =>
      Match.value(isSnapshotProp(property)).pipe(
        Match.when(true, () => unsupportedSnapshot),
        Match.orElse(() => memberOf(target, property, receiver)),
      ),
  })

export const guardedVi = (real: object): object =>
  new Proxy(real, {
    get: (target, property, receiver) =>
      Match.value(isMockProp(property)).pipe(
        Match.when(true, () => () => unsupportedMocking(String(property))),
        Match.orElse(() => memberOf(target, property, receiver)),
      ),
  })
