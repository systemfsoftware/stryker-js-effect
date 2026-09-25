import * as Context from 'effect/Context'

import type { TSCompiler } from './ts-compiler.handle.js'

export interface TypeScriptCompiler extends Context.Service<TypeScriptCompiler, TSCompiler> {}

export const TypeScriptCompiler: TypeScriptCompiler = Context.Service<TypeScriptCompiler, TSCompiler>(
  '@systemfsoftware/stryker-js-typescript-checker/ts-compiler.service/TypeScriptCompiler',
)
