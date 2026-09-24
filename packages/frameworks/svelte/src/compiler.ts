import type { AST } from 'svelte/compiler'

declare module 'estree' {
  interface BaseNode {
    start: number
    end: number
  }
}

export interface CompilerModule {
  readonly VERSION: string
  readonly parse: (source: string, options: { readonly filename: string; readonly modern: true }) => AST.Root
}

type ParseFn = CompilerModule['parse']

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const compilerOf = (module: unknown): CompilerModule | undefined =>
  shapedModule(isShaped(module) ? module : undefined)

const shapedModule = (module: Record<'VERSION' | 'parse', unknown> | undefined): CompilerModule | undefined =>
  module === undefined ? undefined : shapedVersion(module)

const shapedVersion = (module: Record<'VERSION' | 'parse', unknown>): CompilerModule | undefined =>
  shapedParse(module['VERSION'], module['parse'])

const shapedParse = (version: unknown, parse: unknown): CompilerModule | undefined =>
  typeof version === 'string' ? parsedVersion(version, parse) : undefined

const parsedVersion = (version: string, parse: unknown): CompilerModule | undefined =>
  isParseFn(parse) ? { VERSION: version, parse } : undefined

const isParseFn = (value: unknown): value is ParseFn => typeof value === 'function'
const isShaped = (module: unknown): module is Record<'VERSION' | 'parse', unknown> => objectWith(module, 'VERSION')

const objectWith = (module: unknown, key: 'VERSION' | 'parse'): module is Record<'VERSION' | 'parse', unknown> =>
  isObject(module) && key in module
