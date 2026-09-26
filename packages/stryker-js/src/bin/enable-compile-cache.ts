const nodeModule = globalThis.process.getBuiltinModule('node:module')
const compileCache = nodeModule.enableCompileCache()

export const inheritableCompileCacheDirectory = compileCache.status === nodeModule.constants.compileCacheStatus.ENABLED
  ? compileCache.directory
  : undefined
