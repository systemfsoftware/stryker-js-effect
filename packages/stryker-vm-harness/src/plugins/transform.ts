import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import type { Json } from 'effect/Schema'

import type {
  LoadFnOutput,
  LoadHookContext,
  LoadHookSync,
  ResolveFnOutput,
  ResolveHookContext,
  ResolveHookSync,
  VmPluginHost,
  VmSessionPlugin,
} from '../session-plugin.js'
import { applyAlias } from '../vitest-host/alias.js'
import { recordDocblock } from '../vitest-host/docblock-cache.js'
import { hasImportMetaEnv, replaceImportMetaEnvView } from '../vitest-host/import-meta-env.js'
import {
  basename,
  extname,
  fileURLToPath,
  isAbsolute,
  pathToFileURL,
  readFileSync,
  relative,
} from '../vitest-host/node-builtins.js'
import { VM_VITEST_BAG_KEY, type VmTransformResult, type VmVitestRuntime } from '../vitest-host/runtime.js'

type AnyDecoded<A = unknown> = A

const neverContinuation = (): never => {
  throw new Error('the vm runner resolves continuations itself')
}

type ResolveContinuation = (specifier: string, context: ResolveHookContext) => ResolveFnOutput

const continuationOf = (next: ResolveHookSync): ResolveContinuation => {
  const continuation: ResolveContinuation = (specifier, context) => next(specifier, context, neverContinuation)
  return continuation
}

type LoadContinuation = (url: string, context: LoadHookContext) => LoadFnOutput

const loadContinuationOf = (next: LoadHookSync): LoadContinuation => {
  const continuation: LoadContinuation = (url, context) => next(url, context, neverContinuation)
  return continuation
}

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

const rootOf = (runtime: VmVitestRuntime): string =>
  Option.getOrElse(Option.fromNullishOr(runtime.config.projects[0]?.root), () => '')

const isProjectFile = (path: string): boolean => !path.split(/[\\/]/).includes('node_modules')

const OUTSIDE_ROOT_CHECKS: ReadonlyArray<(relativePath: string) => boolean> = [
  (relativePath) => relativePath === '',
  (relativePath) => relativePath.startsWith('..'),
  isAbsolute,
]

const isOutsideRoot = (relativePath: string): boolean => OUTSIDE_ROOT_CHECKS.some((check) => check(relativePath))

const moduleUrlFor = (runtime: VmVitestRuntime, path: string): string => {
  const relativePath = relative(rootOf(runtime), path)
  if (isOutsideRoot(relativePath)) return `/@fs${path}`
  return `/${relativePath.split('\\').join('/')}`
}

const cssModuleCode = `
const styles = new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) })
export default styles
`

const emptyCssCode = `export default ''\n`

const isJsonObject = (value: Json | undefined): value is Readonly<Record<string, Json>> =>
  Predicate.isObject(value) && !Array.isArray(value)

const jsonExportLines = (parsed: Readonly<Record<string, Json>>): ReadonlyArray<string> =>
  Object.keys(parsed).filter(isIdentifier).map((key) => `export const ${key} = value[${JSON.stringify(key)}]`)

const jsonExportLinesOf = (parsed: Json | undefined): ReadonlyArray<string> =>
  isJsonObject(parsed) ? jsonExportLines(parsed) : []

const jsonCode = (content: string): string => {
  const raw: AnyDecoded = JSON.parse(content)
  const parsed = Option.getOrElse(S.decodeUnknownOption(S.Json)(raw), () => undefined)
  const lines = [`const value = ${content}`, 'export default value']
  lines.push(...jsonExportLinesOf(parsed))
  return `${lines.join('\n')}\n`
}

const environmentOf = (host: VmPluginHost): VmVitestRuntime | undefined =>
  host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)

type DecodeInput = Parameters<InstanceType<typeof TextDecoder>['decode']>[0]

const decodeBufferText = (source: DecodeInput): string => new TextDecoder().decode(source)

const viewTextOf = (source: LoadFnOutput['source']): string | undefined =>
  ArrayBuffer.isView(source) ? decodeBufferText(source) : undefined

const arrayBufferTextOf = (source: LoadFnOutput['source']): string | undefined =>
  source instanceof ArrayBuffer ? decodeBufferText(source) : undefined

const nonStringTextOf = (source: LoadFnOutput['source']): string | undefined =>
  viewTextOf(source) ?? arrayBufferTextOf(source)

const sourceTextOf = (source: LoadFnOutput['source']): string | undefined =>
  typeof source === 'string' ? source : nonStringTextOf(source)

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

const injectsCjsGlobals = (runtime: VmVitestRuntime, path: string): boolean =>
  (runtime.projectFor(path).injectCjsGlobals ?? true) === true

const cjsGlobalsSource = (runtime: VmVitestRuntime, path: string, code: string): string =>
  injectsCjsGlobals(runtime, path) ? `${CJS_GLOBALS_PRELUDE}${code}` : code

const hostResult = (runtime: VmVitestRuntime, path: string, code: string): LoadFnOutput => {
  recordDocblock(path, code)
  const rewritten = importMetaVitestSource(code, path)
  const envAware = hasImportMetaEnv(code) ? importMetaEnvSource(rewritten) : rewritten
  return { format: 'module', source: cjsGlobalsSource(runtime, path, envAware), shortCircuit: true }
}

interface ResolveTarget {
  readonly runtime: VmVitestRuntime
  readonly parentPath: string
}

const fileParentPathOf = (parentURL: string): Option.Option<string> =>
  parentURL.startsWith('file:') ? Option.some(fileURLToPath(parentURL)) : Option.none()

const projectParentPathOf = (context: ResolveHookContext): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(context.parentURL),
    (parentURL) => Option.filter(fileParentPathOf(parentURL), isProjectFile),
  )

const resolveTargetOf = (context: ResolveHookContext, host: VmPluginHost): Option.Option<ResolveTarget> =>
  Option.flatMap(
    projectParentPathOf(context),
    (parentPath) => Option.map(Option.fromNullishOr(environmentOf(host)), (runtime) => ({ runtime, parentPath })),
  )

const resolvedFileUrlOf = (runtime: VmVitestRuntime, specifier: string, parentPath: string): Option.Option<string> =>
  Option.map(
    Option.filter(Option.fromNullishOr(runtime.resolveIdSync(specifier, parentPath)), isAbsolute),
    (resolved) => pathToFileURL(resolved).href,
  )

const resolvedFileOutputOf = (
  runtime: VmVitestRuntime,
  specifier: string,
  parentPath: string,
): Option.Option<ResolveFnOutput> =>
  Option.map(resolvedFileUrlOf(runtime, specifier, parentPath), (url) => ({ url, shortCircuit: true }))

const EXTENSION_TABLES: ReadonlyArray<Record<string, true>> = [NATIVE_EXTENSIONS, CSS_EXTENSIONS, ASSET_EXTENSIONS]

const isBareKnownExtension = (specifier: string): boolean => {
  const extension = extname(specifier)
  return EXTENSION_TABLES.some((table) => table[extension] === true)
}

const bareResolveOutputOf = (
  runtime: VmVitestRuntime,
  specifier: string,
  parentPath: string,
): ResolveFnOutput | undefined =>
  isBareKnownExtension(specifier)
    ? undefined
    : Option.getOrUndefined(resolvedFileOutputOf(runtime, specifier, parentPath))

const rethrow = (error: AnyDecoded): never => {
  throw error
}

const catchFallbackOf = (
  runtime: VmVitestRuntime,
  specifier: string,
  parentPath: string,
  error: AnyDecoded,
): ResolveFnOutput => Option.getOrElse(resolvedFileOutputOf(runtime, specifier, parentPath), () => rethrow(error))

const delegateOrFallback = (
  next: ResolveHookSync,
  effective: string,
  context: ResolveHookContext,
  runtime: VmVitestRuntime,
  parentPath: string,
): ResolveFnOutput => {
  try {
    return continuationOf(next)(effective, context)
  } catch (error: unknown) {
    return catchFallbackOf(runtime, effective, parentPath, error)
  }
}

const effectiveSpecifierOf = (specifier: string, aliased: string | undefined): string => aliased ?? specifier

const shouldDelegate = (aliased: string | undefined, conditions: ReadonlyArray<string>): boolean =>
  aliased !== undefined || conditions.length > 0

const resolveForTarget = (
  specifier: string,
  context: ResolveHookContext,
  next: ResolveHookSync,
  target: ResolveTarget,
): ResolveFnOutput | undefined => {
  const project = target.runtime.projectFor(target.parentPath)
  const conditions = [...conditionsOf(context.conditions), ...conditionsOf(project.conditions)]
  const aliased = applyAlias(specifier, project.alias)
  if (!shouldDelegate(aliased, conditions)) {
    return bareResolveOutputOf(target.runtime, specifier, target.parentPath)
  }
  const effective = effectiveSpecifierOf(specifier, aliased)
  return delegateOrFallback(next, effective, { ...context, conditions }, target.runtime, target.parentPath)
}

interface LoadRequest {
  readonly runtime: VmVitestRuntime
  readonly url: string
  readonly path: string
  readonly params: URLSearchParams
  readonly hasRaw: boolean
  readonly hasUrl: boolean
  readonly extension: string
}

const isLoadableUrl = (url: string): boolean => url.startsWith('file:')

const isRequireCondition = (context: LoadHookContext): boolean => conditionsOf(context.conditions).includes('require')

const isDelegableUrl = (url: string, context: LoadHookContext): boolean =>
  isLoadableUrl(url) && !isRequireCondition(context)

const loadableUrlOf = (url: string, context: LoadHookContext): Option.Option<string> =>
  isDelegableUrl(url, context) ? Option.some(url) : Option.none()

const buildLoadRequest = (runtime: VmVitestRuntime, url: string): LoadRequest => {
  const queryAt = url.indexOf('?')
  const path = fileURLToPath(queryAt === -1 ? url : url.slice(0, queryAt))
  const params = new URL(url).searchParams
  const hasRaw = params.has('raw')
  const hasUrl = params.has('url')
  params.delete('salt')
  params.delete('raw')
  params.delete('url')
  return { runtime, url, path, params, hasRaw, hasUrl, extension: extname(path) }
}

const loadRequestOf = (url: string, context: LoadHookContext, host: VmPluginHost): Option.Option<LoadRequest> =>
  Option.flatMap(
    Option.fromNullishOr(environmentOf(host)),
    (runtime) => Option.map(loadableUrlOf(url, context), (loadableUrl) => buildLoadRequest(runtime, loadableUrl)),
  )

const moduleOutput = (source: string): LoadFnOutput => ({ format: 'module', source, shortCircuit: true })

const urlSource = (request: LoadRequest): string =>
  `export default ${JSON.stringify(moduleUrlFor(request.runtime, request.path))}\n`

const rawOutputOf = (request: LoadRequest): LoadFnOutput | undefined =>
  request.hasRaw ? moduleOutput(`export default ${JSON.stringify(readFileSync(request.path))}\n`) : undefined

const urlOutputOf = (request: LoadRequest): LoadFnOutput | undefined =>
  request.hasUrl ? moduleOutput(urlSource(request)) : undefined

const queryOutputOf = (request: LoadRequest): LoadFnOutput | undefined => rawOutputOf(request) ?? urlOutputOf(request)

const hasExtraParams = (params: URLSearchParams): boolean => params.size > 0

const jsonOutputOf = (request: LoadRequest, context: LoadHookContext): LoadFnOutput | undefined =>
  context.importAttributes.type === 'json' ? undefined : moduleOutput(jsonCode(readFileSync(request.path)))

const cssOutputOf = (request: LoadRequest): LoadFnOutput =>
  moduleOutput(isModuleCss(request.path) ? cssModuleCode : emptyCssCode)

const assetOutputOf = (request: LoadRequest): LoadFnOutput => moduleOutput(urlSource(request))

const pipelineOutputOf = (request: LoadRequest): LoadFnOutput | undefined => {
  const pipeline = request.runtime.loadFileSync(request.path)
  return pipeline === undefined ? undefined : hostResult(request.runtime, request.path, pipeline.code)
}

const transformedOutputOf = (request: LoadRequest): LoadFnOutput | undefined => {
  const result = request.runtime.transformSync(readFileSync(request.path), request.path)
  return result === undefined ? undefined : hostResult(request.runtime, request.path, result.code)
}

const nativePipelineOutputOf = (request: LoadRequest): LoadFnOutput | undefined =>
  pipelineOutputOf(request) ?? transformedOutputOf(request)

const delegatedLoadOf = (request: LoadRequest, context: LoadHookContext, next: LoadHookSync): LoadFnOutput =>
  loadContinuationOf(next)(request.url, context)

const nonNativeOutputOf = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
): LoadFnOutput => nativePipelineOutputOf(request) ?? delegatedLoadOf(request, context, next)

const transformExtOutputOf = (request: LoadRequest): LoadFnOutput | undefined =>
  pipelineOutputOf(request) ?? transformedOutputOf(request)

const configTransformOf = (request: LoadRequest): VmTransformResult | undefined =>
  request.runtime.config.configFile === undefined
    ? undefined
    : request.runtime.transformSync(readFileSync(request.path), request.path)

const configTransformedOutputOf = (request: LoadRequest): LoadFnOutput | undefined => {
  const pipeline = configTransformOf(request)
  return pipeline === undefined ? undefined : hostResult(request.runtime, request.path, pipeline.code)
}

const shippedOrLoaded = (loaded: LoadFnOutput, source: string, shipped: string): LoadFnOutput =>
  shipped === source ? loaded : { format: loaded.format, source: shipped }

const shippedNativeSourceOf = (
  runtime: VmVitestRuntime,
  path: string,
  source: string,
  loaded: LoadFnOutput,
): LoadFnOutput => {
  recordDocblock(path, source)
  const inSourceAware = importMetaVitestSource(source, path)
  const shipped = cjsGlobalsSource(runtime, path, inSourceAware)
  return hasImportMetaEnv(source)
    ? { format: loaded.format, source: importMetaEnvSource(shipped) }
    : shippedOrLoaded(loaded, source, shipped)
}

const shippedNativeOutputOf = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
): LoadFnOutput => {
  const loaded = delegatedLoadOf(request, context, next)
  const source = sourceTextOf(loaded.source)
  return source === undefined ? loaded : shippedNativeSourceOf(request.runtime, request.path, source, loaded)
}

const nativeOutputOf = (request: LoadRequest, context: LoadHookContext, next: LoadHookSync): LoadFnOutput =>
  configTransformedOutputOf(request) ?? shippedNativeOutputOf(request, context, next)

type SourceKind = 'transform' | 'non-native' | 'native'

const sourceKindOf = (extension: string): SourceKind =>
  Match.value(extension).pipe(
    Match.when((value: string) => TRANSFORM_EXTENSIONS[value] === true, (): SourceKind => 'transform'),
    Match.when((value: string) => NATIVE_EXTENSIONS[value] === true, (): SourceKind => 'native'),
    Match.orElse((): SourceKind => 'non-native'),
  )

type SourceHandler = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
) => LoadFnOutput | undefined

const SOURCE_KIND_HANDLERS: Record<SourceKind, SourceHandler> = {
  transform: transformExtOutputOf,
  'non-native': nonNativeOutputOf,
  native: nativeOutputOf,
}

const sourceKindOutputOf = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
): LoadFnOutput | undefined => SOURCE_KIND_HANDLERS[sourceKindOf(request.extension)](request, context, next)

const sourceOutputOf = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
): LoadFnOutput | undefined => isProjectFile(request.path) ? sourceKindOutputOf(request, context, next) : undefined

type LoadExtensionKind = 'json' | 'css' | 'asset' | 'source'

const extensionKindOf = (extension: string): LoadExtensionKind =>
  Match.value(extension).pipe(
    Match.when('.json', (): LoadExtensionKind => 'json'),
    Match.when((value: string) => CSS_EXTENSIONS[value] === true, (): LoadExtensionKind => 'css'),
    Match.when((value: string) => ASSET_EXTENSIONS[value] === true, (): LoadExtensionKind => 'asset'),
    Match.orElse((): LoadExtensionKind => 'source'),
  )

const EXTENSION_HANDLERS: Record<LoadExtensionKind, SourceHandler> = {
  json: jsonOutputOf,
  css: cssOutputOf,
  asset: assetOutputOf,
  source: sourceOutputOf,
}

const extensionOutputOf = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
): LoadFnOutput | undefined => EXTENSION_HANDLERS[extensionKindOf(request.extension)](request, context, next)

const afterQueryOutputOf = (
  request: LoadRequest,
  context: LoadHookContext,
  next: LoadHookSync,
): LoadFnOutput | undefined => hasExtraParams(request.params) ? undefined : extensionOutputOf(request, context, next)

const loadOutputOf = (
  url: string,
  context: LoadHookContext,
  next: LoadHookSync,
  host: VmPluginHost,
): LoadFnOutput | undefined =>
  Option.match(loadRequestOf(url, context, host), {
    onNone: () => undefined,
    onSome: (request) => queryOutputOf(request) ?? afterQueryOutputOf(request, context, next),
  })

export const transformPlugin: VmSessionPlugin = {
  name: 'transform',
  resolve: (specifier, context, next, host) =>
    Option.match(resolveTargetOf(context, host), {
      onNone: () => undefined,
      onSome: (target) => resolveForTarget(specifier, context, next, target),
    }),
  load: (url, context, next, host) => loadOutputOf(url, context, next, host),
}
