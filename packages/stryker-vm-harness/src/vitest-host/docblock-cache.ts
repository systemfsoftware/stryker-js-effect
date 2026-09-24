import { fileURLToPath } from 'node:url'

import type { EnvironmentDocblock } from './docblock.js'
import { environmentDocblock } from './docblock.js'
import { existsSync, readFileSync } from './node-builtins.js'

const CACHE_LIMIT = 4096
const DOCBLOCK_HEAD_CHARS = 4096

const EMPTY: EnvironmentDocblock = { environment: undefined, environmentOptions: undefined }

const heads = new Map<string, EnvironmentDocblock>()

const plainFileOf = (file: string): string => {
  const withoutQuery = file.replace(/[?#][\s\S]*$/, '')
  return file.startsWith('file:') ? fileURLToPath(withoutQuery) : withoutQuery
}

export const recordDocblock = (file: string, content: string): void => {
  if (heads.has(file)) return
  if (heads.size >= CACHE_LIMIT) heads.clear()
  heads.set(file, environmentDocblock(content.slice(0, DOCBLOCK_HEAD_CHARS)))
}

const docblockOnDisk = (file: string): EnvironmentDocblock => {
  if (!existsSync(file)) return EMPTY
  try {
    return environmentDocblock(readFileSync(file, 'utf8').slice(0, DOCBLOCK_HEAD_CHARS))
  } catch {
    return EMPTY
  }
}

export const docblockOf = (file: string): EnvironmentDocblock => {
  const known = heads.get(file)
  if (known !== undefined) return known
  const parsed = docblockOnDisk(plainFileOf(file))
  if (heads.size >= CACHE_LIMIT) heads.clear()
  heads.set(file, parsed)
  return parsed
}
