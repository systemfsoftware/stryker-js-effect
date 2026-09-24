import { dual } from 'effect/Function'

import { MOCK_GLOBAL_KEY, shouldHoistSource } from '../mock-module.js'
import { stripTypeScriptTypes } from './node-builtins.js'
import type { MockMagicString, VitestMockerModules } from './vitest-modules.js'

export interface HoistedModule {
  readonly format: 'module'
  readonly source: string
}

const sourceMapUrlOf = (map: object): string =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`

const typeStripped = (source: string, isTypescript: boolean): string =>
  isTypescript ? stripTypeScriptTypes(source) : source

const hoistedTextOf = (hoisted: MockMagicString, id: string): string =>
  `${hoisted.toString()}\n//# sourceMappingURL=${
    sourceMapUrlOf(hoisted.generateMap({ hires: 'boundary', source: id }))
  }`

const applyHoist = (javascript: string, id: string, modules: VitestMockerModules): string => {
  const hoisted = modules.transforms.hoistMocksWithDynamicImports(javascript, id, modules.parse, {
    globalThisAccessor: JSON.stringify(MOCK_GLOBAL_KEY),
  })
  return hoisted === undefined ? javascript : hoistedTextOf(hoisted, id)
}

const hoistSource = (javascript: string, id: string, modules: VitestMockerModules): string =>
  shouldHoistSource(javascript) ? applyHoist(javascript, id, modules) : javascript

/**
 * Moves hoisted `vi.mock`/`vi.hoisted` calls above the imports they must precede.
 * The source is type-stripped first because the hoist parser reads JavaScript;
 * the result is always plain ESM.
 */
export const hoistTestFile = dual<
  (id: string, isTypescript: boolean, modules: VitestMockerModules) => (source: string) => HoistedModule,
  (source: string, id: string, isTypescript: boolean, modules: VitestMockerModules) => HoistedModule
>(4, (source, id, isTypescript, modules): HoistedModule => ({
  format: 'module',
  source: hoistSource(typeStripped(source, isTypescript), id, modules),
}))
