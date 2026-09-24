import { dual } from 'effect/Function'
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

const metaEnvNameOf = (key: string): string | undefined => META_ENV_MEMBER.exec(key)?.[1]

const stringValueOf = (value: Json | undefined): Option.Option<string> =>
  typeof value === 'string' ? Option.some(value) : Option.none()

interface EnvKeyParts {
  readonly name: string
  readonly raw: string
}

const envKeyPartsOf = (define: Readonly<Record<string, Json>>, key: string): Option.Option<EnvKeyParts> =>
  Option.flatMap(
    Option.fromNullishOr(metaEnvNameOf(key)),
    (name) => Option.map(stringValueOf(define[key]), (raw) => ({ name, raw })),
  )

const decodedOrRaw = (raw: string): Json => jsonValueOf(JSON.parse(raw)) ?? raw

const envDecodedValueOf = (raw: string): Json => {
  try {
    return decodedOrRaw(raw)
  } catch {
    return raw
  }
}

const envEntryOf = (
  define: Readonly<Record<string, Json>>,
  key: string,
): Option.Option<readonly [string, Json]> =>
  Option.map(envKeyPartsOf(define, key), (parts) => [parts.name, envDecodedValueOf(parts.raw)] as const)

const envFromDefine = (define: Readonly<Record<string, Json>>): Record<string, Json> => {
  const out: Record<string, Json> = {}
  for (const key of Object.keys(define)) {
    Option.match(envEntryOf(define, key), {
      onNone: () => undefined,
      onSome: ([name, value]) => {
        out[name] = value
      },
    })
  }
  return out
}

const applyEnvEntry = (target: Record<string, Json>, key: string, value: string): void => {
  if (Object.hasOwn(target, key)) return
  target[key] = value
}

const applyDefinedEntry = (target: Record<string, Json>, key: string, value: Json | undefined): void => {
  if (value === undefined) return
  target[key] = value
}

const applyEnvEntries = (target: Record<string, Json>, env: Readonly<Record<string, string>>): void => {
  for (const [key, value] of Object.entries(env)) applyEnvEntry(target, key, value)
}

const applyDefinedEntries = (target: Record<string, Json>, defined: Readonly<Record<string, Json>>): void => {
  for (const [key, value] of Object.entries(defined)) applyDefinedEntry(target, key, value)
}

export const importMetaEnvObject = (input: ImportMetaEnvInput): Record<string, Json> => {
  const base: Record<string, Json> = { MODE: input.mode, DEV: true, PROD: false, SSR: true, BASE_URL: input.baseUrl }
  applyEnvEntries(base, input.env)
  applyDefinedEntries(base, envFromDefine(input.define))
  return base
}

export const importMetaEnvLiteral = (input: ImportMetaEnvInput): string => JSON.stringify(importMetaEnvObject(input))

export const IMPORT_META_ENV_VIEW = `Object.assign(globalThis.__vitest_worker__?.metaEnv ?? import.meta.env)`

const IMPORT_META_ENV_TEST = /\bimport\.meta\.env\b/

export const hasImportMetaEnv = (code: string): boolean => IMPORT_META_ENV_TEST.test(code)

export const replaceImportMetaEnv = dual<
  (literal: string) => (code: string) => string,
  (code: string, literal: string) => string
>(2, (code: string, literal: string): string => replaceCodeToken(code, 'import.meta.env', literal).code)

export const replaceImportMetaEnvView = (code: string): string =>
  replaceCodeToken(code, 'import.meta.env', IMPORT_META_ENV_VIEW).code
