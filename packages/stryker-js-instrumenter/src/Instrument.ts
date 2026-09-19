import * as Effect from 'effect/Effect'
import * as Predicate from 'effect/Predicate'
import type { FileDescription } from './Mutant.js'
import { Mutant as ApiMutant } from './Mutant.schema.js'

import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import type { MutateDescription } from './Instrument.schema.js'
import {
  FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  InstrumentResult as InstrumentResultSchema,
} from './Instrument.schema.js'
import { createParser, getFormat } from './Parser.js'
import { print } from './Printer.js'
import { type Ast, AstFormat, type HtmlAst, type ScriptAst, type SvelteAst } from './Syntax.js'
import { createMutantCollector, transform } from './Transformer.js'
import type { TransformerOptions } from './Transformer.js'

export interface File extends FileDescription {
  name: string
  content: string
}
export interface InstrumentResult {
  files: readonly File[]
  mutants: readonly ApiMutant[]
}

export type { InstrumenterOptions }

import { spanOf } from './Ast.js'
import { toApiMutant } from './Mutator.js'
import { type SpannedComment } from './Syntax.js'

const commentDirectiveRegEx = /^(\s*)@(ts-[a-z-]+).*$/
const tsDirectiveLikeRegEx = /@(ts-[a-z-]+)/
const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

export const disableTypeChecks = (file: File): Effect.Effect<File, InstrumentError> => {
  const format = getFormat(file.name)
  if (format === undefined) return Effect.succeed(file)
  return disableTypeChecksFor(file, format)
}

const disableTypeChecksFor = (file: File, format: AstFormat): Effect.Effect<File, InstrumentError> => {
  if (isJSFileWithoutTSDirectives(file, format)) {
    return Effect.succeed({ ...file, content: prefixWithNoCheck(file.content) })
  }
  const parse = createParser()
  return Effect.map(
    parse(file.content, file.name).pipe(
      Effect.mapError((cause) => InstrumentError.make({ message: `Failed to parse ${file.name}`, cause })),
    ),
    (ast) => withDisabledTypeChecking(file, ast),
  )
}

function withDisabledTypeChecking(file: File, ast: Ast): File {
  switch (ast.format) {
    case 'js':
    case 'ts':
    case 'tsx':
      return { ...file, content: disableTypeCheckingInScript(ast) }
    case 'html':
      return { ...file, content: disableTypeCheckingInHtml(ast) }
    case 'svelte':
      return { ...file, content: disableTypeCheckingInSvelte(ast) }
  }
}

const JS_OR_TS_FORMATS: ReadonlySet<AstFormat> = new Set(['js', 'ts'])

function isJSFileWithoutTSDirectives(file: File, format: AstFormat): boolean {
  return JS_OR_TS_FORMATS.has(format) && !tsDirectiveLikeRegEx.test(file.content)
}
function disableTypeCheckingInScript(ast: ScriptAst): string {
  return prefixWithNoCheck(removeTSDirectives(ast.rawContent, ast.comments))
}
function prefixWithNoCheck(code: string): string {
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
function disableTypeCheckingInHtml(ast: HtmlAst): string {
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
function disableTypeCheckingInSvelte(ast: SvelteAst): string {
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
function toOneBasedLineNumber(range: MutateDescription): MutateDescription {
  if (typeof range === 'boolean') {
    return range
  }
  return range.map(({ start, end }) => ({
    start: { column: start.column, line: start.line + 1 },
    end: { column: end.column, line: end.line + 1 },
  }))
}

function isIgnorer(value: unknown): value is Ignorer {
  return Predicate.isObject(value) && typeof value['shouldIgnore'] === 'function'
}

function toTransformerOptions(options: InstrumenterOptions): TransformerOptions {
  const base: TransformerOptions = {
    excludedMutations: [...options.excludedMutations],
    ignorers: options.ignorers.filter(isIgnorer),
  }
  if (options.noHeader !== undefined) {
    return { ...base, noHeader: options.noHeader }
  }
  return base
}

const AST_SHAPE = ['format', 'root'] as const

function isAst(value: unknown): value is Ast {
  return Predicate.isObject(value) && AST_SHAPE.every((key) => key in value)
}

type FileSchemaType = typeof FileSchema.Type

interface ParsedFile {
  readonly file: FileSchemaType
  readonly ast: Ast
}

function printedFile(file: FileSchemaType, ast: unknown): readonly FileSchemaType[] {
  if (!isAst(ast)) return []
  return [{ name: file.name, mutate: file.mutate, content: print(ast) }]
}

export const instrument = (
  files: readonly File[],
  options: InstrumenterOptions,
  basePath?: string,
): Effect.Effect<InstrumentResult, InstrumentError> =>
  Effect.gen(function*() {
    const schemaFiles: readonly FileSchemaType[] = files.map((file) => ({
      name: file.name,
      content: file.content,
      mutate: file.mutate,
    }))
    const parse = createParser()
    const parsed = yield* Effect.forEach(schemaFiles, (file) =>
      Effect.map(
        parse(file.content, file.name).pipe(
          Effect.mapError((cause) => InstrumentError.make({ message: `Failed to parse ${file.name}`, cause })),
        ),
        (ast): ParsedFile => ({ file, ast }),
      ))
    const collector = createMutantCollector()
    yield* Effect.forEach(parsed, ({ file, ast }) =>
      transform(ast, collector, {
        options: toTransformerOptions(options),
        mutateDescription: toOneBasedLineNumber(file.mutate),
        basePath,
      }).pipe(
        Effect.mapError((cause) => InstrumentError.make({ message: `Failed to transform ${file.name}`, cause })),
      ))
    const mutants: readonly ApiMutant[] = yield* Effect.try({
      try: () => collector.map(toApiMutant),
      catch: (cause) => InstrumentError.make({ message: 'Failed to instrument', cause }),
    })
    const printed = yield* Effect.try({
      try: () => parsed.flatMap(({ file, ast }) => printedFile(file, ast)),
      catch: (cause) => InstrumentError.make({ message: 'Failed to print', cause }),
    })
    return InstrumentResultSchema.make({ files: printed, mutants })
  })
