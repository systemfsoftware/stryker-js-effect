import * as Context from 'effect/Context'

import type { TSCompiler } from './ts-compiler.handle.js'

export interface TypeScriptCompilerShape extends TSCompiler {}

export class TypeScriptCompiler extends Context.Service<TypeScriptCompiler, TypeScriptCompilerShape>()(
  '@systemfsoftware/stryker-js-typescript-checker/ts-compiler.service/TypeScriptCompiler',
) {}
