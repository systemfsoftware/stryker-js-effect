import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'

import { nativeImport } from '../native-import.handle.js'
import type { GlobalTarget } from './global-descriptors.js'
import type { VitestNamespaceSurface } from './harness-globals.js'
import type { FileEnvironment, PackageEnvironment } from './resolve-environment.workflow.js'
import type { VmJson } from './vm-json.js'

const nodeModule = globalThis.process.getBuiltinModule('node:module')

export interface EnvironmentReturn {
  readonly teardown: ((target: GlobalTarget) => void | Promise<void>) | undefined
}

export interface VitestEnvironment {
  readonly name: string
  readonly setup: (target: GlobalTarget, options: Record<string, VmJson>) => Promise<EnvironmentReturn | undefined>
}

export interface VitestRuntimeModules {
  readonly builtinEnvironments: Readonly<Record<string, VitestEnvironment | undefined>>
}

interface EnvironmentModuleCandidate {
  readonly default?: object
}

export const loadVitestRuntimeModules = dual<
  (path: Path.Path) => (vitestPackageJsonPath: string) => Promise<VitestRuntimeModules>,
  (vitestPackageJsonPath: string, path: Path.Path) => Promise<VitestRuntimeModules>
>(2, (vitestPackageJsonPath, path) => {
  const runtimeEntry = nodeModule.createRequire(vitestPackageJsonPath).resolve('vitest/runtime')
  const parentUrl = Effect.runSync(path.toFileUrl(runtimeEntry)).href
  return nativeImport<VitestRuntimeModules>(import.meta.resolve(runtimeEntry, parentUrl))
})

export const loadVitestNamespace = dual<
  (path: Path.Path) => (vitestPackageJsonPath: string) => Promise<VitestNamespaceSurface>,
  (vitestPackageJsonPath: string, path: Path.Path) => Promise<VitestNamespaceSurface>
>(2, (vitestPackageJsonPath, path) => {
  const parentUrl = Effect.runSync(path.toFileUrl(vitestPackageJsonPath)).href
  return nativeImport<VitestNamespaceSurface>(import.meta.resolve('vitest', parentUrl))
})

export const isVitestEnvironment = (candidate: object | undefined): candidate is VitestEnvironment =>
  candidate !== undefined && typeof Reflect.get(candidate, 'setup') === 'function'

export const loadModuleEnvironment = dual<
  (root: string, path: Path.Path) => (spec: FileEnvironment | PackageEnvironment) => Promise<VitestEnvironment>,
  (spec: FileEnvironment | PackageEnvironment, root: string, path: Path.Path) => Promise<VitestEnvironment>
>(3, (spec, root, path) => {
  const url = Match.value(spec).pipe(
    Match.tag('FileEnvironment', (file) => Effect.runSync(path.toFileUrl(file.path)).href),
    Match.tag(
      'PackageEnvironment',
      (custom) => import.meta.resolve(custom.dependency, Effect.runSync(path.toFileUrl(root)).href),
    ),
    Match.exhaustive,
  )
  return nativeImport<EnvironmentModuleCandidate>(url).then((candidate) => {
    const declared = candidate.default
    if (!isVitestEnvironment(declared)) {
      throw new TypeError(
        `Environment "${spec.name}" is not a valid environment. Path "${url}" should export default object with a "setup" or/and "setupVM" method.`,
      )
    }
    return declared
  })
})
