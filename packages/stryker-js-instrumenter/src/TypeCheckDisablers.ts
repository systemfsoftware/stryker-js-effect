import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type { ScriptAst, SpannedComment } from './Ast.schema.js'

export const tsDirectiveLikeRegEx = /@(ts-[a-z-]+)/

const commentDirectiveRegEx = /^(\s*)@(ts-[a-z-]+).*$/
const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

export function disableTypeCheckingInScript(ast: ScriptAst): string {
  return prefixWithNoCheck(removeTSDirectives(ast.rawContent, ast.comments))
}

export function prefixWithNoCheck(code: string): string {
  return code.startsWith('#') ? afterHashbang(code) : afterLeadingComment(code)
}

function afterHashbang(code: string): string {
  const newLineIndex = code.indexOf('\n')
  return newLineIndex <= 0
    ? code
    : `${code.substring(0, newLineIndex)}\n// @ts-nocheck\n${code.substring(newLineIndex + 1)}`
}

function afterLeadingComment(code: string): string {
  const leadingComment = leadingCommentOf(code)
  return leadingComment === undefined
    ? `// @ts-nocheck\n${code}`
    : `${leadingComment.concat('\n')}// @ts-nocheck\n${code.substring(leadingComment.length)}`
}

function leadingCommentOf(code: string): string | undefined {
  return STARTING_COMMENT.exec(code)?.[0]
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
  return Option.match(Option.fromNullishOr(commentDirectiveRegEx.exec(comment.value)), {
    onNone: () => undefined,
    onSome: (match) => directiveRangeAt(comment.start, lengthOf(match[1]), lengthOf(match[2])),
  })
}

const lengthOf = (text: string | undefined): number =>
  Option.getOrElse(Option.map(Option.fromNullishOr(text), (value) => value.length), () => 0)

const directiveRangeAt = (commentStart: number, prefixLength: number, nameLength: number): DirectiveRange => {
  const startPos = commentStart + prefixLength + 2
  return { startPos, endPos: startPos + nameLength + 1 }
}
