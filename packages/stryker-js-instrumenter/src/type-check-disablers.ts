import * as Predicate from 'effect/Predicate'
import { spanOf } from './Ast.js'
import type { HtmlAst, ScriptAst, SpannedComment, SvelteAst } from './Syntax.js'

export const tsDirectiveLikeRegEx = /@(ts-[a-z-]+)/

const commentDirectiveRegEx = /^(\s*)@(ts-[a-z-]+).*$/
const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

export function disableTypeCheckingInScript(ast: ScriptAst): string {
  return prefixWithNoCheck(removeTSDirectives(ast.rawContent, ast.comments))
}

export function disableTypeCheckingInHtml(ast: HtmlAst): string {
  const sortedScripts = [...ast.root.scripts].sort((a, b) => getScriptStart(a) - getScriptStart(b))
  let currentIndex = 0
  let html = ''
  for (const script of sortedScripts) {
    html += ast.rawContent.substring(currentIndex, getScriptStart(script))
    html += '\n'
    html += prefixWithNoCheck(removeTSDirectives(script.rawContent, script.comments))
    html += '\n'
    currentIndex = getScriptEnd(script)
  }
  html += ast.rawContent.substring(currentIndex)
  return html
}

export function disableTypeCheckingInSvelte(ast: SvelteAst): string {
  const sortedScripts = [ast.root.moduleScript, ...ast.root.additionalScripts].filter(Predicate.isNotNullish).sort((
    a,
    b,
  ) => a.range.start - b.range.start)
  let currentIndex = 0
  let html = ''
  for (const script of sortedScripts) {
    html += ast.rawContent.substring(currentIndex, script.range.start)
    html += '\n'
    html += prefixWithNoCheck(removeTSDirectives(script.ast.rawContent, script.ast.comments))
    html += '\n'
    currentIndex = script.range.end
  }
  html += ast.rawContent.substring(currentIndex)
  return html
}

export function prefixWithNoCheck(code: string): string {
  if (code.startsWith('#')) return afterHashbang(code)
  return afterLeadingComment(code)
}

function afterHashbang(code: string): string {
  const newLineIndex = code.indexOf('\n')
  if (newLineIndex <= 0) return code
  return `${code.substring(0, newLineIndex)}\n// @ts-nocheck\n${code.substring(newLineIndex + 1)}`
}

function afterLeadingComment(code: string): string {
  const leadingComment = leadingCommentOf(code)
  if (leadingComment === undefined) return `// @ts-nocheck\n${code}`
  return `${leadingComment.concat('\n')}// @ts-nocheck\n${code.substring(leadingComment.length)}`
}

function leadingCommentOf(code: string): string | undefined {
  return STARTING_COMMENT.exec(code)?.[0]
}

function getScriptStart(script: HtmlAst['root']['scripts'][number]): number {
  const span = spanOf(script.root)
  if (span === undefined) {
    throw new Error('Script AST root without start')
  }
  return span.start
}

function getScriptEnd(script: HtmlAst['root']['scripts'][number]): number {
  const span = spanOf(script.root)
  if (span === undefined) {
    throw new Error('Script AST root without end')
  }
  return span.end
}

interface DirectiveRange {
  readonly startPos: number
  readonly endPos: number
}

function removeTSDirectives(
  text: string,
  comments: readonly SpannedComment[] | null | undefined,
): string {
  return removeRanges(text, directiveRanges(comments))
}

function directiveRanges(comments: readonly SpannedComment[] | null | undefined): readonly DirectiveRange[] {
  return (comments ?? [])
    .map(tryParseTSDirective)
    .filter(Predicate.isNotNullish)
    .sort((a, b) => a.startPos - b.startPos)
}

function removeRanges(text: string, ranges: readonly DirectiveRange[]): string {
  const remaining = ranges.reduce(
    (state, range) => ({
      pruned: state.pruned + text.substring(state.cursor, range.startPos),
      cursor: range.endPos,
    }),
    { pruned: '', cursor: 0 },
  )
  return remaining.pruned + text.substring(remaining.cursor)
}

function tryParseTSDirective(comment: SpannedComment): DirectiveRange | undefined {
  const match = commentDirectiveRegEx.exec(comment.value)
  if (match === null) return undefined
  const directivePrefix = requirePart(match[1], 'TS directive match without prefix')
  const directiveName = requirePart(match[2], 'TS directive match without directive name')
  const startPos = comment.start + directivePrefix.length + 2
  return { startPos, endPos: startPos + directiveName.length + 1 }
}

function requirePart(part: string | undefined, message: string): string {
  if (part === undefined) throw new Error(message)
  return part
}
