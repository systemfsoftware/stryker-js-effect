import { dual } from 'effect/Function'

import { type MockFactoryOrOptions, reflectiveValue, type VitestModuleMocker } from './mocker.js'

export interface MockAwareVi {
  readonly resetModules: () => void
}

type ViMocker = Pick<
  VitestModuleMocker,
  'queueMock' | 'queueUnmock' | 'importActual' | 'importMock' | 'resetModules'
>

type MockFactoryInput = ((importOriginal: () => Promise<object>) => object | Promise<object>) | {
  readonly spy?: boolean
}

const factoryOrOptionsOf = (factory: MockFactoryInput | undefined): MockFactoryOrOptions | undefined => factory

const resetModulesValue = (mocker: ViMocker, receiver: object): () => object => (): object => {
  mocker.resetModules()
  return receiver
}

const mockValue =
  (mocker: ViMocker, receiver: object): (path: string, factory?: MockFactoryInput) => object =>
  (path, factory): object => {
    mocker.queueMock(path, '', factoryOrOptionsOf(factory))
    return receiver
  }

const doMockValue =
  (mocker: ViMocker): (path: string, factory?: MockFactoryInput) => object => (path, factory): object => {
    mocker.queueMock(path, '', factoryOrOptionsOf(factory))
    return {
      [Symbol.dispose]: (): void => {
        mocker.queueUnmock(path, '')
      },
    }
  }

const unmockValue = (mocker: ViMocker): (path: string) => void => (path): void => {
  mocker.queueUnmock(path, '')
}

const importActualValue =
  (mocker: ViMocker): <A = object>(path: string) => Promise<A> => <A = object>(path: string): Promise<A> =>
    mocker.importActual<A>(path, '')

const importMockValue = (mocker: ViMocker): (path: string) => Promise<object> => (path): Promise<object> =>
  mocker.importMock(path, '')

type MockValueOf = (mocker: ViMocker, receiver: object) => object

const MOCK_VALUES: Record<string, MockValueOf> = {
  resetModules: resetModulesValue,
  mock: mockValue,
  doMock: (mocker) => doMockValue(mocker),
  unmock: (mocker) => unmockValue(mocker),
  doUnmock: (mocker) => unmockValue(mocker),
  importActual: (mocker) => importActualValue(mocker),
  importMock: (mocker) => importMockValue(mocker),
}

const mockValueOf = (property: PropertyKey): MockValueOf | undefined =>
  typeof property === 'string' ? MOCK_VALUES[property] : undefined

const mockAwareGet = (
  real: object,
  mocker: ViMocker,
  property: PropertyKey,
  receiver: object,
): object | string | number | boolean | undefined => {
  const valueOf = mockValueOf(property)
  return valueOf === undefined ? reflectiveValue(Reflect.get(real, property, receiver)) : valueOf(mocker, receiver)
}

export const mockAwareVi = dual<
  (mocker: ViMocker) => (real: object) => object,
  (real: object, mocker: ViMocker) => object
>(2, (real, mocker): object =>
  new Proxy(real, {
    get: (target, property, receiver: object): object | string | number | boolean | undefined =>
      mockAwareGet(target, mocker, property, receiver),
  }))
