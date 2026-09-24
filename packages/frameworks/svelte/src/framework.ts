import type {
  EmbeddedDocument,
  Framework,
  FrameworkContext,
  FrameworkContractVersion,
  FrameworkParseResult,
  Program,
  ScriptFormat,
  ScriptRegion,
  Statement,
} from '@systemfsoftware/stryker-framework-interface'
import type { AST } from 'svelte/compiler'

import type { CompilerModule } from './compiler.js'
import { attemptedDiscovery, discoveredOf, type Discovery, failureMessageOf, type LocatedRegion } from './discovery.js'

const CONTRACT_VERSION: FrameworkContractVersion = '1'

const NEWLINE = '\n'
const NO_CHECK = '// @ts-nocheck'
const TS_LANGUAGE = 'ts'
const DIRECTIVE_PATTERN = /^(\s*)@(ts-[a-z-]+).*$/
const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

export const svelteFramework = (compiler: CompilerModule): Framework => ({
  kind: 'Framework',
  name: 'svelte',
  claim: svelteClaim(compiler.VERSION),
  parse: (rawContent, context) => parseDocument(compiler, rawContent, context),
  transform: (document, context) => placedDocument(compiler, document, context),
  print: (document, context) => printedDocument(document, context),
  disableTypeChecks: (rawContent) => noCheckedDocument(compiler, rawContent),
})

const svelteClaim = (ownerVersion: string): Framework['claim'] => ({
  formatId: 'svelte',
  extensions: ['.svelte'],
  language: 'svelte',
  ownerVersion,
  contractVersion: CONTRACT_VERSION,
})

const parseDocument = (
  compiler: CompilerModule,
  rawContent: string,
  context: FrameworkContext,
): FrameworkParseResult<EmbeddedDocument> =>
  attemptParse(() => documentOf(rawContent, context, discoveredOf(compiler, rawContent)))

const attemptParse = (parse: () => EmbeddedDocument): FrameworkParseResult<EmbeddedDocument> => {
  try {
    return { kind: 'Parsed', value: parse() }
  } catch (cause) {
    return { kind: 'ParseFailed', message: failureMessageOf(cause) }
  }
}

const documentOf = (
  rawContent: string,
  context: FrameworkContext,
  discovery: Discovery,
): EmbeddedDocument => ({
  formatId: 'svelte',
  rawContent,
  regions: discovery.regions.map((located) => regionOf(rawContent, context, located)),
})

const regionOf = (
  rawContent: string,
  context: FrameworkContext,
  located: LocatedRegion,
): ScriptRegion => ({
  start: located.start,
  end: located.end,
  isExpression: located.isExpression,
  scriptAst: context.parseScript(rawContent.substring(located.start, located.end), located.scriptFormat),
})

const placedDocument = (
  compiler: CompilerModule,
  document: EmbeddedDocument,
  context: FrameworkContext,
): EmbeddedDocument => {
  const header = context.instrumentationHeader()
  const stripped = document.regions.map((region) => stripPlacedHeader(region.scriptAst, header))
  return stripped.some((wasPlaced) => wasPlaced) ? headerDocument(compiler, document, header) : document
}

const statementIdentity = (statement: Statement): string => `${statement.type}:${statement.start}:${statement.end}`

const stripPlacedHeader = (program: Program, header: readonly Statement[]): boolean =>
  header.length === 0 ? false : stripPrefix(program, header)

const stripPrefix = (program: Program, header: readonly Statement[]): boolean => {
  const placed = header.every(headerPrefix(program))
  return placed ? removePrefix(program, header) : false
}

const removePrefix = (program: Program, header: readonly Statement[]): boolean => {
  program.body.splice(0, header.length)
  return true
}

const headerPrefix = (program: Program) => (expected: Statement, index: number): boolean =>
  sameStatement(program.body.at(index), expected)

const sameStatement = (present: Statement | undefined, expected: Statement): boolean =>
  present !== undefined && statementIdentity(present) === statementIdentity(expected)

const headerDocument = (
  compiler: CompilerModule,
  document: EmbeddedDocument,
  header: readonly Statement[],
): EmbeddedDocument => placedHeaderDocument(document, header, attemptedDiscovery(compiler, document.rawContent))

const placedHeaderDocument = (
  document: EmbeddedDocument,
  header: readonly Statement[],
  discovery: FrameworkParseResult<Discovery>,
): EmbeddedDocument => modulePlaced(document, header, discovery, locatedModuleRegion(document, discovery))

const locatedModuleRegion = (
  document: EmbeddedDocument,
  discovery: FrameworkParseResult<Discovery>,
): ScriptRegion | undefined => discovery.kind === 'Parsed' ? moduleRegionOf(document, discovery.value) : undefined

const moduleRegionOf = (document: EmbeddedDocument, discovery: Discovery): ScriptRegion | undefined =>
  matchingModule(document, locatedModule(discovery))

const locatedModule = (discovery: Discovery): LocatedRegion | undefined =>
  discovery.regions.find((region) => region.isModuleScript)

const matchingModule = (document: EmbeddedDocument, located: LocatedRegion | undefined): ScriptRegion | undefined =>
  located === undefined ? undefined : document.regions.find(sharesSpan(located))

const sharesSpan = (located: LocatedRegion) => (region: ScriptRegion): boolean =>
  region.start === located.start && region.end === located.end

const modulePlaced = (
  document: EmbeddedDocument,
  header: readonly Statement[],
  discovery: FrameworkParseResult<Discovery>,
  moduleRegion: ScriptRegion | undefined,
): EmbeddedDocument => {
  if (moduleRegion !== undefined) {
    moduleRegion.scriptAst.body.unshift(...header)
    return document
  }
  return prependModuleScript(document, header, parsedFormat(discovery))
}

const parsedFormat = (discovery: FrameworkParseResult<Discovery>): ScriptFormat =>
  definedFormat(instanceRegionOf(discovery.kind === 'Parsed' ? discovery.value : undefined))

const definedFormat = (region: LocatedRegion | undefined): ScriptFormat => formatOrJs(optionalFormat(region))

const optionalFormat = (region: LocatedRegion | undefined): ScriptFormat | undefined => region?.scriptFormat

const formatOrJs = (format: ScriptFormat | undefined): ScriptFormat => format ?? 'js'

const instanceRegionOf = (discovery: Discovery | undefined): LocatedRegion | undefined =>
  discovery?.regions.find((region) => !region.isModuleScript && !region.isExpression)

const moduleOpenTag = (scriptFormat: ScriptFormat): string =>
  scriptFormat === TS_LANGUAGE ? '<script module lang="ts">\n' : '<script module>\n'

const prependModuleScript = (
  document: EmbeddedDocument,
  header: readonly Statement[],
  scriptFormat: ScriptFormat,
): EmbeddedDocument => {
  const openTag = moduleOpenTag(scriptFormat)
  const block = `${openTag}\n</script>\n`
  return {
    ...document,
    rawContent: `${block}${document.rawContent}`,
    regions: [emptyModuleRegion(openTag, header), ...document.regions.map(shiftRegion(block.length))],
  }
}

const emptyModuleRegion = (openTag: string, header: readonly Statement[]): ScriptRegion => ({
  start: openTag.length,
  end: openTag.length,
  isExpression: false,
  scriptAst: moduleProgramOf(header),
})

const shiftRegion = (offset: number) => (region: ScriptRegion): ScriptRegion => ({
  ...region,
  start: region.start + offset,
  end: region.end + offset,
})

const moduleProgramOf = (header: readonly Statement[]): Program => ({
  type: 'Program',
  sourceType: 'module',
  body: [...header],
  hashbang: null,
})

const printedDocument = (document: EmbeddedDocument, context: FrameworkContext): string => {
  let printed = ''
  let cursor = 0
  for (const region of document.regions.toSorted(byStart)) {
    printed += document.rawContent.substring(cursor, region.start)
    printed += printedRegion(region, context)
    cursor = region.end
  }
  return printed + document.rawContent.substring(cursor)
}

const byStart = (left: { readonly start: number }, right: { readonly start: number }): number =>
  left.start - right.start

const printedRegion = (region: ScriptRegion, context: FrameworkContext): string => {
  const printed = context.printScript(region.scriptAst)
  return region.isExpression ? unpunctuated(printed) : framedScript(printed)
}

const unpunctuated = (printed: string): string => strippedSemicolon(printed.trimEnd())

const strippedSemicolon = (trimmed: string): string => (trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed)

const framedScript = (printed: string): string => `${NEWLINE}${printed}${NEWLINE}`

const noCheckedDocument = (compiler: CompilerModule, rawContent: string): FrameworkParseResult<string> => {
  const discovery = attemptedDiscovery(compiler, rawContent)
  if (discovery.kind === 'ParseFailed') {
    return discovery
  }
  return { kind: 'Parsed', value: noCheckedContent(rawContent, discovery.value) }
}

interface Splice {
  readonly start: number
  readonly end: number
  readonly replacement: string
}

const noCheckedContent = (rawContent: string, discovery: Discovery): string => {
  const scripts = scriptRegionsOf(discovery)
  return applyRightToLeft(rawContent, [
    ...scriptSplices(rawContent, discovery, scripts),
    ...outsideDirectives(discovery.root.comments, scripts),
  ])
}

const scriptRegionsOf = (discovery: Discovery): readonly LocatedRegion[] =>
  discovery.regions.filter((region) => !region.isExpression)

const scriptSplices = (
  rawContent: string,
  discovery: Discovery,
  scripts: readonly LocatedRegion[],
): readonly Splice[] => scripts.map(scriptSplice(rawContent, discovery.root.comments))

const scriptSplice = (rawContent: string, comments: readonly AST.JSComment[]) => (region: LocatedRegion): Splice => ({
  start: region.start,
  end: region.end,
  replacement: framedScript(regionReplacement(rawContent, region, comments)),
})

const regionReplacement = (
  rawContent: string,
  region: LocatedRegion,
  comments: readonly AST.JSComment[],
): string => prefixWithNoCheck(applyRightToLeft(bodyOf(rawContent, region), innerSplices(region, comments)))

const bodyOf = (rawContent: string, region: LocatedRegion): string => rawContent.substring(region.start, region.end)

const innerSplices = (region: LocatedRegion, comments: readonly AST.JSComment[]): readonly Splice[] =>
  containedComments(region, comments).map(regionSplice(region)).filter(definedSplice)

const regionSplice = (region: LocatedRegion) => (comment: AST.JSComment): Splice | undefined =>
  directiveSplice(comment, -region.start)

const containedComments = (region: LocatedRegion, comments: readonly AST.JSComment[]): readonly AST.JSComment[] =>
  comments.filter(inRegion(region))

const inRegion = (region: LocatedRegion) => (comment: AST.JSComment): boolean =>
  comment.start >= region.start && comment.end <= region.end

const definedSplice = (splice: Splice | undefined): splice is Splice => splice !== undefined

const outsideDirectives = (
  comments: readonly AST.JSComment[],
  scripts: readonly LocatedRegion[],
): readonly Splice[] => comments.filter(outsideScripts(scripts)).map(topLevelSplice).filter(definedSplice)

const outsideScripts = (scripts: readonly LocatedRegion[]) => (comment: AST.JSComment): boolean =>
  !scripts.some(containsComment(comment))

const topLevelSplice = (comment: AST.JSComment): Splice | undefined => directiveSplice(comment, 0)

const containsComment = (comment: AST.JSComment) => (region: LocatedRegion): boolean =>
  comment.start >= region.start && comment.end <= region.end

const directiveSplice = (comment: AST.JSComment, offset: number): Splice | undefined =>
  directiveCapture(DIRECTIVE_PATTERN.exec(comment.value), comment, offset)

const directiveCapture = (
  match: RegExpExecArray | null,
  comment: AST.JSComment,
  offset: number,
): Splice | undefined => (match === null ? undefined : directiveRanges(comment, offset, match.input))

const directiveRanges = (comment: AST.JSComment, offset: number, value: string): Splice => {
  const atSign = value.indexOf('@')
  return rangeSplice(comment.start + offset + atSign + 2, directiveToken(value.substring(atSign + 1)))
}

const directiveToken = (afterAt: string): string => afterAt.substring(0, tokenEnd(afterAt))

const tokenEnd = (text: string): number => {
  const end = text.search(/[^a-z-]/)
  return end === -1 ? text.length : end
}

const rangeSplice = (start: number, directive: string): Splice => ({
  start,
  end: start + directive.length + 1,
  replacement: '',
})

const applyRightToLeft = (text: string, splices: readonly Splice[]): string =>
  accumulateSplices(text, splices.toSorted(byDescendingStart), text.length, '')

const accumulateSplices = (text: string, splices: readonly Splice[], tail: number, out: string): string => {
  const head = splices.at(0)
  return head === undefined ? `${text.substring(0, tail)}${out}` : splicedTail(text, splices, head, tail, out)
}

const splicedTail = (text: string, splices: readonly Splice[], head: Splice, tail: number, out: string): string =>
  accumulateSplices(text, splices.slice(1), head.start, `${head.replacement}${text.substring(head.end, tail)}${out}`)

const byDescendingStart = (left: Splice, right: Splice): number => right.start - left.start

const prefixWithNoCheck = (
  code: string,
): string => (code.startsWith('#') ? withHashbangNoCheck(code) : withCommentNoCheck(code))

const withHashbangNoCheck = (code: string): string => {
  const newLineIndex = code.indexOf(NEWLINE)
  return newLineIndex <= 0 ? code : hashbangSplice(code, newLineIndex)
}

const hashbangSplice = (code: string, newLineIndex: number): string =>
  `${code.substring(0, newLineIndex)}${NEWLINE}${NO_CHECK}${NEWLINE}${code.substring(newLineIndex + 1)}`

const withCommentNoCheck = (code: string): string => commentPrefix(STARTING_COMMENT.exec(code)?.at(0), code)

const commentPrefix = (leadingComment: string | undefined, code: string): string =>
  leadingComment === undefined ? `${NO_CHECK}${NEWLINE}${code}` : commentSplice(code, leadingComment)

const commentSplice = (code: string, leadingComment: string): string =>
  `${leadingComment}${NEWLINE}${NO_CHECK}${NEWLINE}${code.substring(leadingComment.length)}`
