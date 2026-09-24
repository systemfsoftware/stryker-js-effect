import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import type { Json } from 'effect/Schema'

export interface EnvironmentDocblock {
  readonly environment: string | undefined
  readonly environmentOptions: Readonly<Record<string, Json>> | undefined
}

const EMPTY: EnvironmentDocblock = { environment: undefined, environmentOptions: undefined }

const ENVIRONMENT_TAG = /@vitest-environment\s+([^\s*]+)/
const OPTIONS_TAG = /@vitest-environment-options\s+(\{)/

const parseJsonObject = (text: string, braceIndex: number): Readonly<Record<string, Json>> | undefined => {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = braceIndex; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          return Option.getOrElse(
            S.decodeUnknownOption(S.Record(S.String, S.Json))(JSON.parse(text.slice(braceIndex, index + 1))),
            () => undefined,
          )
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

const tagsOf = (commentBody: string): EnvironmentDocblock | undefined => {
  const environment = ENVIRONMENT_TAG.exec(commentBody)?.[1]
  const optionsMatch = OPTIONS_TAG.exec(commentBody)
  const optionsBrace = optionsMatch?.[1]
  const environmentOptions = optionsMatch === null || optionsBrace === undefined
    ? undefined
    : parseJsonObject(commentBody, optionsMatch.index + optionsBrace.length - 1)
  if (environment === undefined && environmentOptions === undefined) return undefined
  return { environment, environmentOptions }
}

export const environmentDocblock = (source: string): EnvironmentDocblock => {
  const scanner = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
  let index = 0
  while (index < source.length) {
    while (
      index < source.length &&
      (source[index] === ' ' || source[index] === '\t' || source[index] === '\n' || source[index] === '\r')
    ) {
      index++
    }
    if (index >= source.length || (!source.startsWith('//', index) && !source.startsWith('/*', index))) break
    scanner.lastIndex = index
    const match = scanner.exec(source)
    if (match === null) break
    const tags = tagsOf(match[0])
    if (tags !== undefined) return tags
    index = scanner.lastIndex
  }
  return EMPTY
}
