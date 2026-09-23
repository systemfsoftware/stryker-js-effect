import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import type { Program } from './Ast.js'
import type { Position } from './Location.schema.js'
import { AstFormat as SchemaAstFormat } from './Syntax.schema.js'

export const AstFormat = SchemaAstFormat
export type AstFormat = SchemaAstFormat
export interface AstByFormat {
  html: HtmlAst
  js: JSAst
  ts: TSAst
  tsx: TsxAst
  svelte: SvelteAst
}
export type Ast = HtmlAst | JSAst | SvelteAst | TSAst | TsxAst

export type ScriptFormat = Extract<AstFormat, 'js' | 'ts' | 'tsx'>

export interface SpannedComment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}
export type ScriptAst = JSAst | TSAst | TsxAst
export interface BaseAst {
  originFileName: string
  rawContent: string
  root: Ast['root']
  offset?: Position
}

export interface HtmlAst extends BaseAst {
  format: 'html'
  root: HtmlRootNode
}

export interface JSAst extends BaseAst {
  format: 'js'
  root: Program
  comments: readonly SpannedComment[]
}

export interface TSAst extends BaseAst {
  format: 'ts'
  root: Program
  comments: readonly SpannedComment[]
}

export interface TsxAst extends BaseAst {
  format: 'tsx'
  root: Program
  comments: readonly SpannedComment[]
}

export interface SvelteAst extends BaseAst {
  format: 'svelte'
  root: SvelteRootNode
}

export interface HtmlRootNode {
  scripts: ScriptAst[]
}

export interface SvelteRootNode {
  moduleScript?: TemplateScript
  additionalScripts: TemplateScript[]
}

export interface TemplateScript {
  ast: ScriptAst
  range: Range
  isExpression: boolean
}

export interface Range {
  start: number
  end: number
}

export interface SourceLocationInFile {
  end: Position
  start: Position
}

export const locationIncluded: {
  (haystack: SourceLocationInFile, needle: SourceLocationInFile): boolean
  (needle: SourceLocationInFile): (haystack: SourceLocationInFile) => boolean
} = dual(
  (args: IArguments): boolean => args.length >= 2,
  (haystack: SourceLocationInFile, needle: SourceLocationInFile): boolean =>
    comparePositions(haystack.start, needle.start) <= 0 && comparePositions(haystack.end, needle.end) >= 0,
)

export const locationOverlaps: {
  (a: SourceLocationInFile, b: SourceLocationInFile): boolean
  (b: SourceLocationInFile): (a: SourceLocationInFile) => boolean
} = dual(
  (args: IArguments): boolean => args.length >= 2,
  (a: SourceLocationInFile, b: SourceLocationInFile): boolean =>
    comparePositions(a.start, b.end) <= 0 && comparePositions(a.end, b.start) >= 0,
)

function comparePositions(a: Position, b: Position): number {
  const lineDelta = a.line - b.line
  if (lineDelta !== 0) return lineDelta
  return a.column - b.column
}

export type BinaryOperator =
  | '-'
  | '!='
  | '!=='
  | '*'
  | '**'
  | '/'
  | '&'
  | '%'
  | '^'
  | '+'
  | '<'
  | '<<'
  | '<='
  | '=='
  | '==='
  | '>'
  | '>='
  | '>>'
  | '>>>'
  | '|'
  | 'in'
  | 'instanceof'

export type LineStarts = readonly number[]

const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/g

export function computeLineStarts(text: string): LineStarts {
  const terminatorEnds = [...text.matchAll(LINE_TERMINATOR)].map((match) => match.index + match[0].length)
  return [0, ...terminatorEnds]
}

export const positionFromOffset: {
  (lineStarts: LineStarts, offset: number): Position
  (offset: number): (lineStarts: LineStarts) => Position
} = dual(
  (args: IArguments): boolean => args.length >= 2,
  (lineStarts: LineStarts, offset: number): Position => {
    const lineNumber = computeLineOfPosition(lineStarts, offset)
    const lineStart = lineStarts[lineNumber]
    if (lineStart === undefined) {
      throw new Error('Line start not found for computed line number')
    }
    return {
      line: lineNumber,
      column: offset - lineStart,
    }
  },
)

function computeLineOfPosition(
  lineStarts: LineStarts,
  offset: number,
): number {
  const lastLine = lastLineStart(lineStarts, offset, 0, lineStarts.length - 1)
  if (lastLine === -1) {
    throw new Error('position cannot precede the beginning of the file')
  }
  return lastLine
}

function lastLineStart(
  array: readonly number[],
  offset: number,
  low: number,
  high: number,
): number {
  if (low > high) return low - 1
  const middle = middleIndex(low, high)
  const midValue = requireMidpoint(array[middle])
  return Match.value(midValue).pipe(
    Match.when(offset, () => middle),
    Match.when((mid) => mid < offset, () => lastLineStart(array, offset, middle + 1, high)),
    Match.orElse(() => lastLineStart(array, offset, low, middle - 1)),
  )
}

function middleIndex(low: number, high: number): number {
  return low + ((high - low) >> 1)
}

function requireMidpoint(midValue: number | undefined): number {
  if (midValue === undefined) {
    throw new Error('Binary search middle value is missing')
  }
  return midValue
}
