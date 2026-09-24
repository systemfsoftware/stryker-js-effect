import * as Match from 'effect/Match'

export interface HostEnvironment {
  readonly read: (name: string) => string | undefined
  readonly write: (name: string, value: string) => void
  readonly remove: (name: string) => void
}

const isEnvironmentObject = (candidate: unknown): candidate is Record<string, string | undefined> =>
  typeof candidate === 'object' && candidate !== null

const environmentObjectOf = (descriptor: PropertyDescriptor | undefined): Record<string, string | undefined> =>
  Match.value(descriptor).pipe(
    Match.when(Match.undefined, (): Record<string, string | undefined> => ({})),
    Match.orElse((present) => isEnvironmentObject(present.value) ? present.value : {}),
  )

const stringPropertyOf = (descriptor: PropertyDescriptor | undefined): string | undefined =>
  Match.value(descriptor).pipe(
    Match.when(Match.undefined, (): string | undefined => undefined),
    Match.orElse((present) => typeof present.value === 'string' ? present.value : undefined),
  )

export const hostEnvironmentOf = (): HostEnvironment => {
  const environment = environmentObjectOf(Object.getOwnPropertyDescriptor(globalThis.process, 'env'))
  return {
    read: (name) => stringPropertyOf(Object.getOwnPropertyDescriptor(environment, name)),
    write: (name, value) => {
      Reflect.set(environment, name, value)
    },
    remove: (name) => {
      Reflect.deleteProperty(environment, name)
    },
  }
}
