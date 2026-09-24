import type { MockFactoryOrOptions, VitestModuleMocker } from './mocker.js'

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

export const mockAwareVi = (real: object, mocker: ViMocker): object =>
  new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'resetModules') {
        return (): object => {
          mocker.resetModules()
          return receiver
        }
      }
      if (property === 'mock' || property === 'doMock') {
        return (path: string, factory?: MockFactoryInput): object => {
          mocker.queueMock(path, '', factoryOrOptionsOf(factory))
          if (property === 'mock') {
            return receiver
          }
          const disposable: Record<symbol, () => void> = {
            [Symbol.dispose]: () => {
              mocker.queueUnmock(path, '')
            },
          }
          return disposable
        }
      }
      if (property === 'unmock' || property === 'doUnmock') {
        return (path: string): void => {
          mocker.queueUnmock(path, '')
        }
      }
      if (property === 'importActual') {
        return <A = object>(path: string): Promise<A> => mocker.importActual<A>(path, '')
      }
      if (property === 'importMock') {
        return (path: string): Promise<object> => mocker.importMock(path, '')
      }
      return Reflect.get(target, property, receiver)
    },
  })
