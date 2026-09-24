import type { LoadFnOutput, LoadHookSync, ResolveFnOutput, ResolveHookSync } from 'node:module'

import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, extname, isAbsolute, readFileSync, relative } from '../vitest-host/node-builtins.js'

import type { VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import { applyAlias } from '../vitest-host/alias.js'
import { recordDocblock } from '../vitest-host/docblock-cache.js'
import { hasImportMetaEnv, replaceImportMetaEnvView } from '../vitest-host/import-meta-env.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from '../vitest-host/runtime.js'

type ResolveContinuation = (
  specifier: Parameters<ResolveHookSync>[0],
  context?: Partial<Parameters<ResolveHookSync>[1]>,
) => ResolveFnOutput

const continuationOf = (next: ResolveHookSync): ResolveContinuation => next as ResolveContinuation

type LoadContinuation = (
  url: Parameters<LoadHookSync>[0],
  context?: Partial<Parameters<LoadHookSync>[1]>,
) => LoadFnOutput

const loadContinuationOf = (next: LoadHookSync): LoadContinuation => next as LoadContinuation

const CSS_EXTENSIONS: Record<string, true> = {
  '.css': true,
  '.scss': true,
  '.sass': true,
  '.less': true,
  '.styl': true,
  '.stylus': true,
  '.pcss': true,
  '.postcss': true,
}
const ASSET_EXTENSIONS: Record<string, true> = {
  '.svg': true,
  '.png': true,
  '.jpg': true,
  '.jpeg': true,
  '.gif': true,
  '.webp': true,
  '.avif': true,
  '.ico': true,
  '.woff': true,
  '.woff2': true,
  '.ttf': true,
  '.otf': true,
  '.eot': true,
  '.mp4': true,
  '.webm': true,
  '.mp3': true,
  '.wav': true,
}
const TRANSFORM_EXTENSIONS: Record<string, true> = {
  '.tsx': true,
  '.jsx': true,
  '.vue': true,
  '.svelte': true,
  '.mdx': true,
}
const NATIVE_EXTENSIONS: Record<string, true> = {
  '.js': true,
  '.mjs': true,
  '.cjs': true,
  '.ts': true,
  '.mts': true,
  '.cts': true,
  '.json': true,
  '.node': true,
}

const RESERVED_WORDS: Record<string, true> = {
  break: true,
  case: true,
  catch: true,
  class: true,
  const: true,
  continue: true,
  debugger: true,
  default: true,
  delete: true,
  do: true,
  else: true,
  enum: true,
  export: true,
  extends: true,
  false: true,
  finally: true,
  for: true,
  function: true,
  if: true,
  import: true,
  in: true,
  instanceof: true,
  new: true,
  null: true,
  return: true,
  super: true,
  switch: true,
  this: true,
  throw: true,
  true: true,
  try: true,
  typeof: true,
  var: true,
  void: true,
  while: true,
  with: true,
}

const isIdentifier = (key: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && RESERVED_WORDS[key] !== true

const isModuleCss = (path: string): boolean => /\.module\.[^.]+$/.test(basename(path))

const rootOf = (runtime: VmVitestRuntime): string => runtime.config.projects[0]?.root ?? ''

const isProjectFile = (path: string): boolean => !path.split(/[\\/]/).includes('node_modules')

const moduleUrlFor = (runtime: VmVitestRuntime, path: string): string => {
  const relativePath = relative(rootOf(runtime), path)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return `/@fs${path}`
  }
  return `/${relativePath.split('\\').join('/')}`
}

const cssModuleCode = `
const styles = new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) })
export default styles
`

const emptyCssCode = `export default ''\n`

const jsonCode = (content: string): string => {
  const parsed = Option.getOrElse(S.decodeUnknownOption(S.Json)(JSON.parse(content)), () => undefined)
  const lines = [`const value = ${content}`, 'export default value']
  if (
    parsed !== undefined &&
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed)
  ) {
    for (const key of Object.keys(parsed)) {
      if (isIdentifier(key)) lines.push(`export const ${key} = value[${JSON.stringify(key)}]`)
    }
  }
  return `${lines.join('\n')}\n`
}

const environmentOf = (host: VmPluginHost): VmVitestRuntime | undefined =>
  host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)

const sourceTextOf = (source: LoadFnOutput['source']): string | undefined => {
  if (typeof source === 'string') return source
  if (source === undefined) return undefined
  if (source instanceof ArrayBuffer) return new TextDecoder().decode(source)
  if (ArrayBuffer.isView(source)) return new TextDecoder().decode(source)
  return undefined
}

const conditionsOf = (conditions: ReadonlyArray<string> | undefined): ReadonlyArray<string> => conditions ?? []

const IMPORT_META_VITEST_TEST = /\bimport\.meta\.vitest\b/
const IMPORT_META_VITEST_GLOBAL = /\bimport\.meta\.vitest\b/g

const importMetaVitestSource = (code: string, path: string): string => {
  if (!IMPORT_META_VITEST_TEST.test(code)) return code
  const rewritten = code.replace(IMPORT_META_VITEST_GLOBAL, () => 'IMPORT_META_TEST()')
  const filename = path.split('"').join('\\"')
  return `${rewritten};\nfunction IMPORT_META_TEST() { if (typeof __vitest_worker__ === 'undefined' || __vitest_worker__.filepath !== "${filename}") return undefined; const state = globalThis[Symbol.for("@systemfsoftware/stryker-js/vm-runner")]; if (state === undefined || state.api === undefined) return __vitest_worker__.vitestIndex; return { ...__vitest_worker__.vitestIndex, test: state.api.it, it: state.api.it, describe: state.api.describe, suite: state.api.suite, expect: state.expect ?? __vitest_worker__.vitestIndex?.expect, vi: state.vi ?? __vitest_worker__.vitestIndex?.vi, beforeAll: state.api.beforeAll, afterAll: state.api.afterAll, beforeEach: state.api.beforeEach, afterEach: state.api.afterEach }; }`
}

const importMetaEnvSource = (code: string): string => replaceImportMetaEnvView(code)

const CJS_GLOBALS_PRELUDE = `import { createRequire as __vmCreateRequire } from 'node:module'
const require = __vmCreateRequire(import.meta.url)
const module = { exports: {} }
const exports = module.exports
const __filename = new URL(import.meta.url).pathname
const __dirname = __filename.split('/').slice(0, -1).join('/') || '/'
`

const cjsGlobalsSource = (runtime: VmVitestRuntime, path: string, code: string): string => {
  if ((runtime.projectFor(path).injectCjsGlobals ?? true) !== true) return code
  return `${CJS_GLOBALS_PRELUDE}${code}`
}
const hostResult = (runtime: VmVitestRuntime, path: string, code: string): LoadFnOutput => {
  recordDocblock(path, code)
  const rewritten = importMetaVitestSource(code, path)
  const envAware = hasImportMetaEnv(code) ? importMetaEnvSource(rewritten) : rewritten
  return { format: 'module', source: cjsGlobalsSource(runtime, path, envAware), shortCircuit: true }
}

export const transformPlugin: VmSessionPlugin = {
  name: 'transform',
  resolve: (specifier, context, next, host) => {
    const runtime = environmentOf(host)
    if (runtime === undefined || context.parentURL === undefined || !context.parentURL.startsWith('file:')) {
      return undefined
    }
    const parentPath = fileURLToPath(context.parentURL)
    if (!isProjectFile(parentPath)) return undefined
    const project = runtime.projectFor(parentPath)
    const conditions = [...conditionsOf(context.conditions), ...conditionsOf(project.conditions)]
    const extendedContext = { ...context, conditions }
    const aliased = applyAlias(specifier, project.alias)
    if (aliased === undefined && conditions.length === 0) {
      if (
        NATIVE_EXTENSIONS[extname(specifier)] !== true && CSS_EXTENSIONS[extname(specifier)] !== true &&
        ASSET_EXTENSIONS[extname(specifier)] !== true
      ) {
        const resolved = runtime.resolveIdSync(specifier, parentPath)
        if (resolved !== undefined && isAbsolute(resolved)) {
          return { url: pathToFileURL(resolved).href, shortCircuit: true }
        }
      }
      return undefined
    }
    const effective = aliased ?? specifier
    const continueResolve = continuationOf(next)
    try {
      return continueResolve(effective, extendedContext)
    } catch (error: unknown) {
      const resolved = runtime.resolveIdSync(effective, parentPath)
      if (resolved !== undefined && isAbsolute(resolved)) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true }
      }
      throw error
    }
  },
  load: (url, context, next, host) => {
    const runtime = environmentOf(host)
    if (runtime === undefined || !url.startsWith('file:') || conditionsOf(context.conditions).includes('require')) {
      return undefined
    }
    const queryAt = url.indexOf('?')
    const path = fileURLToPath(queryAt === -1 ? url : url.slice(0, queryAt))
    const params = new URL(url).searchParams
    const rawQuery = params.has('raw')
    const urlQuery = params.has('url')
    params.delete('salt')
    params.delete('raw')
    params.delete('url')
    const extension = extname(path)

    if (rawQuery) {
      return {
        format: 'module',
        source: `export default ${JSON.stringify(readFileSync(path, 'utf8'))}\n`,
        shortCircuit: true,
      }
    }
    if (urlQuery) {
      return {
        format: 'module',
        source: `export default ${JSON.stringify(moduleUrlFor(runtime, path))}\n`,
        shortCircuit: true,
      }
    }
    if (params.size > 0) return undefined
    if (extension === '.json') {
      if (context.importAttributes.type === 'json') return undefined
      return { format: 'module', source: jsonCode(readFileSync(path, 'utf8')), shortCircuit: true }
    }
    if (CSS_EXTENSIONS[extension] === true) {
      return { format: 'module', source: isModuleCss(path) ? cssModuleCode : emptyCssCode, shortCircuit: true }
    }
    if (ASSET_EXTENSIONS[extension] === true) {
      return {
        format: 'module',
        source: `export default ${JSON.stringify(moduleUrlFor(runtime, path))}\n`,
        shortCircuit: true,
      }
    }
    if (!isProjectFile(path)) return undefined
    if (TRANSFORM_EXTENSIONS[extension] === true) {
      const raw = readFileSync(path, 'utf8')
      const pipeline = runtime.loadFileSync(path)
      if (pipeline !== undefined) {
        return hostResult(runtime, path, pipeline.code)
      }
      const transformed = runtime.transformSync(raw, path)
      const code = transformed?.code
      if (code !== undefined) {
        return hostResult(runtime, path, code)
      }
      return undefined
    }
    if (NATIVE_EXTENSIONS[extension] !== true) {
      const pipeline = runtime.loadFileSync(path)
      if (pipeline !== undefined) return hostResult(runtime, path, pipeline.code)
      const result = runtime.transformSync(readFileSync(path, 'utf8'), path)
      if (result !== undefined) return hostResult(runtime, path, result.code)
      const continueNativeLoad = loadContinuationOf(next)
      return continueNativeLoad(url, context)
    }
    const raw = readFileSync(path, 'utf8')
    const pipeline = runtime.config.configFile === undefined ? undefined : runtime.transformSync(raw, path)
    if (pipeline !== undefined) {
      return hostResult(runtime, path, pipeline.code)
    }
    const continueLoad = loadContinuationOf(next)
    const loaded = continueLoad(url, context)
    const source = sourceTextOf(loaded.source)
    if (source === undefined) return loaded
    recordDocblock(path, source)
    const inSourceAware = importMetaVitestSource(source, path)
    const shipped = cjsGlobalsSource(runtime, path, inSourceAware)
    if (!hasImportMetaEnv(source)) {
      return shipped === source ? loaded : { format: loaded.format, source: shipped }
    }
    return { format: loaded.format, source: importMetaEnvSource(shipped) }
  },
}
