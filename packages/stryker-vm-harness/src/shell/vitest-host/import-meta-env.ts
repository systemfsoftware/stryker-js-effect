import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import type { Json } from 'effect/Schema'

import { replaceCodeToken } from './code-rewrite.js'

export interface ImportMetaEnvInput {
  readonly mode: string
  readonly baseUrl: string
  readonly env: Readonly<Record<string, string>>
  readonly define: Readonly<Record<string, Json>>
}

const META_ENV_MEMBER = /^import\.meta\.env\.(.+)$/

const jsonValueOf = <A = unknown>(raw: A): Json | undefined =>
  Option.getOrElse(S.decodeUnknownOption(S.Json)(raw), () => undefined)

const envFromDefine = (define: Readonly<Record<string, Json>>): Record<string, Json> => {
  const out: Record<string, Json> = {}
  for (const key of Object.keys(define)) {
    const match = META_ENV_MEMBER.exec(key)
    if (match === null) continue
    const raw = define[key]
    if (typeof raw !== 'string') continue
    const name = match[1]
    if (name === undefined) continue
    try {
      const decoded = jsonValueOf(JSON.parse(raw))
      out[name] = decoded ?? raw
    } catch {
      out[name] = raw
    }
  }
  return out
}

export const importMetaEnvObject = (input: ImportMetaEnvInput): Record<string, Json> => {
  const base: Record<string, Json> = { MODE: input.mode, DEV: true, PROD: false, SSR: true, BASE_URL: input.baseUrl }
  for (const key of Object.keys(input.env)) {
    if (Object.hasOwn(base, key)) continue
    const value = input.env[key]
    if (value === undefined) continue
    base[key] = value
  }
  const defined = envFromDefine(input.define)
  for (const key of Object.keys(defined)) {
    const value = defined[key]
    if (value === undefined) continue
    base[key] = value
  }
  return base
}

export const importMetaEnvLiteral = (input: ImportMetaEnvInput): string => JSON.stringify(importMetaEnvObject(input))

export const IMPORT_META_ENV_VIEW = `Object.assign(globalThis.__vitest_worker__?.metaEnv ?? import.meta.env)`

const IMPORT_META_ENV_TEST = /\bimport\.meta\.env\b/

export const hasImportMetaEnv = (code: string): boolean => IMPORT_META_ENV_TEST.test(code)

export const replaceImportMetaEnv = (code: string, literal: string): string =>
  replaceCodeToken(code, 'import.meta.env', literal).code

export const replaceImportMetaEnvView = (code: string): string =>
  replaceCodeToken(code, 'import.meta.env', IMPORT_META_ENV_VIEW).code
