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
const NOT_FOUND = -1

const environmentTagOf = (body: string): string | undefined => ENVIRONMENT_TAG.exec(body)?.[1]

const braceIndexOf = (match: RegExpExecArray, braceLength: number): number => match.index + braceLength - 1

const optionsBraceIndexOf = (body: string): Option.Option<number> => {
  const match = OPTIONS_TAG.exec(body)
  if (match === null) return Option.none()
  return Option.map(Option.fromNullishOr(match[1]), (brace) => braceIndexOf(match, brace.length))
}

const areAbsent = (environment: string | undefined, options: Readonly<Record<string, Json>> | undefined): boolean =>
  environment === undefined && options === undefined

const tagsOf = (commentBody: string): EnvironmentDocblock | undefined => {
  const environment = environmentTagOf(commentBody)
  const environmentOptions = environmentOptionsOf(commentBody)
  return areAbsent(environment, environmentOptions) ? undefined : { environment, environmentOptions }
}

type JsonCharKind = 'open-brace' | 'close-brace' | 'quote' | 'backslash' | 'other'

const JSON_CHAR_KINDS: Record<string, JsonCharKind> = {
  '{': 'open-brace',
  '}': 'close-brace',
  '"': 'quote',
  '\\': 'backslash',
}

const jsonCharKindOf = (char: string): JsonCharKind => JSON_CHAR_KINDS[char] ?? 'other'

interface JsonScanState {
  readonly text: string
  index: number
  depth: number
  inString: boolean
  escaped: boolean
  end: number
}

const advanceOne = (state: JsonScanState): void => {
  state.index += 1
}

const unescape = (state: JsonScanState): void => {
  state.escaped = false
}

const escape = (state: JsonScanState): void => {
  state.escaped = true
}

const stepStringBackslash = (state: JsonScanState): void => {
  if (state.escaped) unescape(state)
  else escape(state)
  advanceOne(state)
}

const stepStringQuote = (state: JsonScanState): void => {
  if (state.escaped) unescape(state)
  else state.inString = false
  advanceOne(state)
}

const stepStringOther = (state: JsonScanState): void => {
  if (state.escaped) unescape(state)
  advanceOne(state)
}

const finishObject = (state: JsonScanState): void => {
  state.end = state.index
  state.index = state.text.length
}

const stepOpenBrace = (state: JsonScanState): void => {
  state.depth += 1
  advanceOne(state)
}

const stepCloseBrace = (state: JsonScanState): void => {
  state.depth -= 1
  if (state.depth === 0) finishObject(state)
  else advanceOne(state)
}

const stepQuote = (state: JsonScanState): void => {
  state.inString = true
  advanceOne(state)
}

const stepOther = (state: JsonScanState): void => {
  advanceOne(state)
}

type JsonStepHandler = (state: JsonScanState) => void

const STRING_STEP_HANDLERS: Record<JsonCharKind, JsonStepHandler> = {
  'open-brace': stepStringOther,
  'close-brace': stepStringOther,
  quote: stepStringQuote,
  backslash: stepStringBackslash,
  other: stepStringOther,
}

const OBJECT_STEP_HANDLERS: Record<JsonCharKind, JsonStepHandler> = {
  'open-brace': stepOpenBrace,
  'close-brace': stepCloseBrace,
  quote: stepQuote,
  backslash: stepOther,
  other: stepOther,
}

const stepHandlersOf = (state: JsonScanState): Record<JsonCharKind, JsonStepHandler> =>
  state.inString ? STRING_STEP_HANDLERS : OBJECT_STEP_HANDLERS

const scanJsonObject = (state: JsonScanState): void => {
  while (state.index < state.text.length) {
    stepHandlersOf(state)[jsonCharKindOf(state.text.charAt(state.index))](state)
  }
}

const decodeObject = (
  text: string,
  braceIndex: number,
  end: number,
): Readonly<Record<string, Json>> | undefined => {
  try {
    return Option.getOrElse(
      S.decodeUnknownOption(S.Record(S.String, S.Json))(JSON.parse(text.slice(braceIndex, end + 1))),
      () => undefined,
    )
  } catch {
    return undefined
  }
}

const parsedResultOf = (state: JsonScanState, braceIndex: number): Readonly<Record<string, Json>> | undefined =>
  state.end === NOT_FOUND ? undefined : decodeObject(state.text, braceIndex, state.end)

const parseJsonObject = (text: string, braceIndex: number): Readonly<Record<string, Json>> | undefined => {
  const state: JsonScanState = {
    text,
    index: braceIndex,
    depth: 0,
    inString: false,
    escaped: false,
    end: NOT_FOUND,
  }
  scanJsonObject(state)
  return parsedResultOf(state, braceIndex)
}

const environmentOptionsOf = (body: string): Readonly<Record<string, Json>> | undefined =>
  Option.getOrElse(
    Option.map(optionsBraceIndexOf(body), (braceIndex) => parseJsonObject(body, braceIndex)),
    () => undefined,
  )

const WHITESPACE = /[ \t\n\r]/

const isWhitespaceAt = (source: string, index: number): boolean => WHITESPACE.test(source.charAt(index))

const startsCommentAt = (source: string, index: number): boolean =>
  source.startsWith('//', index) || source.startsWith('/*', index)

type DocblockCharKind = 'whitespace' | 'comment' | 'other'

const nonCommentKindAt = (source: string, index: number): DocblockCharKind =>
  isWhitespaceAt(source, index) ? 'whitespace' : 'other'

const docblockKindAt = (source: string, index: number): DocblockCharKind =>
  startsCommentAt(source, index) ? 'comment' : nonCommentKindAt(source, index)

const COMMENT_SCANNER = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g

interface CommentSpan {
  readonly end: number
  readonly tags: EnvironmentDocblock | undefined
}

const commentSpanOf = (source: string, index: number): CommentSpan => {
  COMMENT_SCANNER.lastIndex = index
  const match = COMMENT_SCANNER.exec(source)
  if (match === null) return { end: source.length, tags: undefined }
  return { end: COMMENT_SCANNER.lastIndex, tags: tagsOf(match[0]) }
}

interface DocblockScanState {
  readonly source: string
  index: number
  result: EnvironmentDocblock | undefined
}

const stop = (state: DocblockScanState): void => {
  state.index = state.source.length
}

const stepWhitespace = (state: DocblockScanState): void => {
  state.index += 1
}

const stepComment = (state: DocblockScanState): void => {
  const span = commentSpanOf(state.source, state.index)
  state.result = span.tags
  if (span.tags === undefined) state.index = span.end
  else stop(state)
}

type DocblockStepHandler = (state: DocblockScanState) => void

const DOCBLOCK_STEP_HANDLERS: Record<DocblockCharKind, DocblockStepHandler> = {
  whitespace: stepWhitespace,
  comment: stepComment,
  other: stop,
}

const scanLeadingComments = (state: DocblockScanState): void => {
  while (state.index < state.source.length) {
    DOCBLOCK_STEP_HANDLERS[docblockKindAt(state.source, state.index)](state)
  }
}

export const environmentDocblock = (source: string): EnvironmentDocblock => {
  const state: DocblockScanState = { source, index: 0, result: undefined }
  scanLeadingComments(state)
  return state.result ?? EMPTY
}
