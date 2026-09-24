const fsModule = process.getBuiltinModule('node:fs')
const pathModule = process.getBuiltinModule('node:path')

export const existsSync = (path: string | URL): boolean => fsModule.existsSync(path)

export const readFileSync = (path: string, encoding: 'utf8'): string => fsModule.readFileSync(path, encoding)

export const globSync = (
  pattern: string,
  options: { readonly cwd: string; readonly exclude?: (entry: string) => boolean },
): ReadonlyArray<string> => fsModule.globSync(pattern, { ...options, withFileTypes: false })

export const basename = (path: string, suffix?: string): string => pathModule.basename(path, suffix)
export const dirname = (path: string): string => pathModule.dirname(path)
export const extname = (path: string): string => pathModule.extname(path)
export const isAbsolute = (path: string): boolean => pathModule.isAbsolute(path)
export const join = (...parts: ReadonlyArray<string>): string => pathModule.join(...parts)
export const relative = (from: string, to: string): string => pathModule.relative(from, to)
export const resolve = (...parts: ReadonlyArray<string>): string => pathModule.resolve(...parts)
