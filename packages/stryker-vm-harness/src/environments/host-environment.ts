export interface HostEnvironment {
  readonly read: (name: string) => string | undefined
  readonly write: (name: string, value: string) => void
  readonly remove: (name: string) => void
}

const isEnvironmentObject = (candidate: unknown): candidate is Record<string, string | undefined> =>
  typeof candidate === 'object' && candidate !== null

export const hostEnvironmentOf = (): HostEnvironment => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.process, 'env')
  const environment = descriptor !== undefined && isEnvironmentObject(descriptor.value) ? descriptor.value : {}
  return {
    read: (name) => {
      const value = Object.getOwnPropertyDescriptor(environment, name)
      return typeof value?.value === 'string' ? value.value : undefined
    },
    write: (name, value) => {
      Reflect.set(environment, name, value)
    },
    remove: (name) => {
      Reflect.deleteProperty(environment, name)
    },
  }
}
