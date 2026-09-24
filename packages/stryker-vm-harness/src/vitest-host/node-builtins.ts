import { dual } from 'effect/Function'

const fsModule = globalThis.process.getBuiltinModule('node:fs')
const pathModule = globalThis.process.getBuiltinModule('node:path')
const urlModule = globalThis.process.getBuiltinModule('node:url')

export interface GlobOptions {
  readonly cwd: string
  readonly exclude?: (entry: string) => boolean
}

export const existsSync = (path: string | URL): boolean => fsModule.existsSync(path)

export const readFileSync = (path: string): string => fsModule.readFileSync(path, 'utf8')

export const globSync = dual<
  (options: GlobOptions) => (pattern: string) => ReadonlyArray<string>,
  (pattern: string, options: GlobOptions) => ReadonlyArray<string>
>(
  2,
  (pattern: string, options: GlobOptions): ReadonlyArray<string> =>
    fsModule.globSync(pattern, { ...options, withFileTypes: false }),
)

export const basename = (path: string): string => pathModule.basename(path)
export const dirname = (path: string): string => pathModule.dirname(path)
export const extname = (path: string): string => pathModule.extname(path)
export const isAbsolute = (path: string): boolean => pathModule.isAbsolute(path)
export const join = (...parts: ReadonlyArray<string>): string => pathModule.join(...parts)
export const relative = dual<
  (to: string) => (from: string) => string,
  (from: string, to: string) => string
>(2, (from: string, to: string): string => pathModule.relative(from, to))
export const resolve = (...parts: ReadonlyArray<string>): string => pathModule.resolve(...parts)

export const realpath = (path: string): string => {
  try {
    return fsModule.realpathSync(path)
  } catch {
    return path
  }
}

export const fileURLToPath = (url: string | URL): string => urlModule.fileURLToPath(url)
export const pathToFileURL = (path: string): URL => urlModule.pathToFileURL(path)
