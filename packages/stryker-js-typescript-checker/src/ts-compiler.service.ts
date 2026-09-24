import * as Context from 'effect/Context'

import type { TSCompiler } from './ts-compiler.handle.js'

export class TypeScriptCompiler extends Context.Service<TypeScriptCompiler, TSCompiler>()(
  '@systemfsoftware/stryker-js-typescript-checker/ts-compiler.service/TypeScriptCompiler',
) {}
