import { dual } from 'effect/Function'

import type { EnvironmentDocblock } from './docblock.js'
import { environmentDocblock } from './docblock.js'
import { existsSync, fileURLToPath, readFileSync } from './node-builtins.js'

const CACHE_LIMIT = 4096
const DOCBLOCK_HEAD_CHARS = 4096

const EMPTY: EnvironmentDocblock = { environment: undefined, environmentOptions: undefined }

const heads = new Map<string, EnvironmentDocblock>()

const withoutQuery = (file: string): string => file.replace(/[?#][\s\S]*$/, '')

const plainFileOf = (file: string): string =>
  file.startsWith('file:') ? fileURLToPath(withoutQuery(file)) : withoutQuery(file)

const remember = (file: string, parsed: EnvironmentDocblock): void => {
  if (heads.size >= CACHE_LIMIT) heads.clear()
  heads.set(file, parsed)
}

export const recordDocblock = dual<
  (content: string) => (file: string) => void,
  (file: string, content: string) => void
>(2, (file: string, content: string): void => {
  if (heads.has(file)) return
  remember(file, environmentDocblock(content.slice(0, DOCBLOCK_HEAD_CHARS)))
})

const parsedOnDisk = (file: string): EnvironmentDocblock => {
  try {
    return environmentDocblock(readFileSync(file).slice(0, DOCBLOCK_HEAD_CHARS))
  } catch {
    return EMPTY
  }
}

const docblockOnDisk = (file: string): EnvironmentDocblock => existsSync(file) ? parsedOnDisk(file) : EMPTY

export const docblockOf = (file: string): EnvironmentDocblock => {
  const known = heads.get(file)
  if (known !== undefined) return known
  const parsed = docblockOnDisk(plainFileOf(file))
  remember(file, parsed)
  return parsed
}
