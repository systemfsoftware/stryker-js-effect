const nodeModule = 'getBuiltinModule' in globalThis.process
  ? globalThis.process.getBuiltinModule('node:module')
  : undefined

const enabledStatus = nodeModule?.constants.compileCacheStatus.ENABLED

const canEnableCompileCache = (loaded: typeof nodeModule): loaded is NonNullable<typeof nodeModule> =>
  typeof loaded?.enableCompileCache === 'function'

const enabledDirectoryOf = (loaded: NonNullable<typeof nodeModule>): string | undefined => {
  const compileCache = loaded.enableCompileCache()
  return compileCache.status === enabledStatus ? compileCache.directory : undefined
}

export const inheritableCompileCacheDirectory = canEnableCompileCache(nodeModule)
  ? enabledDirectoryOf(nodeModule)
  : undefined
