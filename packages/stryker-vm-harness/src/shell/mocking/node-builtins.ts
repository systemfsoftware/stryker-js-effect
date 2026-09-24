import { fileURLToPath, pathToFileURL } from 'node:url'

const fsModule = process.getBuiltinModule('node:fs')
const pathModule = process.getBuiltinModule('node:path')
const moduleBuiltin = process.getBuiltinModule('node:module')

export const createRequire = moduleBuiltin.createRequire.bind(moduleBuiltin)
export const isBuiltin = moduleBuiltin.isBuiltin.bind(moduleBuiltin)
export const stripTypeScriptTypes = moduleBuiltin.stripTypeScriptTypes.bind(moduleBuiltin)
export const readFileSync = fsModule.readFileSync.bind(fsModule)
export const existsSync = fsModule.existsSync.bind(fsModule)
export const dirname = pathModule.dirname.bind(pathModule)
export const join = pathModule.join.bind(pathModule)
export const resolve = pathModule.resolve.bind(pathModule)

export { fileURLToPath, pathToFileURL }
