import { MOCK_GLOBAL_KEY, shouldHoistSource } from '../mock-module.js'
import { stripTypeScriptTypes } from './node-builtins.js'
import type { VitestMockerModules } from './vitest-modules.js'

export interface HoistedModule {
  readonly format: 'module'
  readonly source: string
}

const sourceMapUrlOf = (map: object): string =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`

/**
 * Moves hoisted `vi.mock`/`vi.hoisted` calls above the imports they must precede.
 * The source is type-stripped first because the hoist parser reads JavaScript;
 * the result is always plain ESM.
 */
export const hoistTestFile = (
  source: string,
  id: string,
  isTypescript: boolean,
  modules: VitestMockerModules,
): HoistedModule => {
  const javascript = isTypescript ? stripTypeScriptTypes(source) : source
  if (!shouldHoistSource(javascript)) {
    return { format: 'module', source: javascript }
  }
  const hoisted = modules.transforms.hoistMocksWithDynamicImports(javascript, id, modules.parse, {
    globalThisAccessor: JSON.stringify(MOCK_GLOBAL_KEY),
  })
  if (hoisted === undefined) {
    return { format: 'module', source: javascript }
  }
  return {
    format: 'module',
    source: `${hoisted.toString()}\n//# sourceMappingURL=${
      sourceMapUrlOf(hoisted.generateMap({ hires: 'boundary', source: id }))
    }`,
  }
}
