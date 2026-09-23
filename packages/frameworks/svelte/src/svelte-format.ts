import type {
  EmbeddedDocument,
  FormatId,
  Framework,
  FrameworkContext,
  FrameworkContractVersion,
  FrameworkParseResult,
  Program,
  ScriptFormat,
  ScriptRegion,
  Statement,
} from '@systemfsoftware/stryker-framework-interface'

import { isNonEmptyArray, isRecord, isString } from './guards.js'

export interface SvelteCompilerModule {
  readonly VERSION: string
  readonly parse: (source: string, options: { readonly filename: string }) => unknown
  readonly walk?: SvelteWalkFn
}

export type SvelteWalkFn = (root: unknown, handlers: { readonly enter: (node: unknown) => void }) => unknown

const FORMAT_NAME = 'svelte'
const LANGUAGE = 'svelte'
const CONTRACT_VERSION: FrameworkContractVersion = '1'
const EXTENSIONS: readonly string[] = ['.svelte']

const NEWLINE = '\n'
const NO_CHECK = '// @ts-nocheck'
const PARSE_FILENAME = 'component.svelte'
const SCRIPT_MODULE_OPEN = '<script context="module">\n'
const SCRIPT_MODULE_BLOCK = `${SCRIPT_MODULE_OPEN}\n</script>\n`
const TS_LANGUAGE = 'ts'
const LANG_ATTRIBUTE = 'lang'

const TEMPLATE_EXPRESSION_TYPES: Readonly<Record<string, true>> = {
  AwaitBlock: true,
  ConstTag: true,
  EachBlock: true,
  EventHandler: true,
  IfBlock: true,
  KeyBlock: true,
  MustacheTag: true,
  RawMustacheTag: true,
}

const HTML_MISSING = 'Svelte AST without html'
const SCRIPT_RANGE_MISSING = 'Svelte script without a source range'
const PROGRAM_MISSING = 'A script region without its parsed program cannot be printed'
const NON_ERROR_FAILURE = 'the svelte compiler reported a failure that is not an Error'

const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

const FORMAT_ID: FormatId = FORMAT_NAME

const hasSpan = (value: Record<string, unknown>): boolean =>
  typeof value['start'] === 'number' && typeof value['end'] === 'number'

const isRanged = (value: unknown): value is { readonly start: number; readonly end: number } =>
  isRecord(value) && hasSpan(value)

const fieldOf = (record: unknown, key: string): unknown => (isRecord(record) ? record[key] : undefined)

const firstOf = (value: unknown): unknown => (isNonEmptyArray(value) ? value.at(0) : value)

const dataOf = (node: unknown): unknown => fieldOf(node, 'data')

interface LocatedRegion {
  readonly start: number
  readonly end: number
  readonly isExpression: boolean
  readonly scriptFormat: ScriptFormat
  readonly isModuleScript: boolean
}

const regionFrom = (
  range: { readonly start: number; readonly end: number },
  attributes: unknown,
  isModuleScript: boolean,
): LocatedRegion => ({
  start: range.start,
  end: range.end,
  isExpression: false,
  scriptFormat: scriptFormatOf(attributes),
  isModuleScript,
})

const langPatternOf = (attribute: string): RegExp => new RegExp(`${attribute}\\s*=\\s*["']([^"']*)["']`)

const langAttributeOf = (attributes: unknown): unknown =>
  isNonEmptyArray(attributes)
    ? fieldOf(attributes.find((attribute) => fieldOf(attribute, 'name') === LANG_ATTRIBUTE), 'value')
    : undefined

const langListOf = (attributes: unknown): unknown => firstOf(langAttributeOf(attributes))

const matchLangOf = (tag: string): string | undefined => tag.match(langPatternOf(LANG_ATTRIBUTE))?.[1]

const langOf = (attributes: unknown): unknown =>
  isString(attributes) ? matchLangOf(attributes) : dataOf(langListOf(attributes))

const scriptFormatOf = (attributes: unknown): ScriptFormat => (langOf(attributes) === TS_LANGUAGE ? 'ts' : 'js')

const byStart = (left: LocatedRegion, right: LocatedRegion): number => left.start - right.start

const appendRegion = (collected: LocatedRegion[], region: LocatedRegion | undefined): void => {
  if (region !== undefined) {
    collected.push(region)
  }
}

const rangedContentOf = (script: unknown): { readonly start: number; readonly end: number } => {
  const content = fieldOf(script, 'content')
  if (!isRanged(content)) {
    throw new Error(SCRIPT_RANGE_MISSING)
  }
  return content
}

const scriptNodeRegion = (script: unknown, rawContent: string, isModuleScript: boolean): LocatedRegion | undefined => {
  if (script == null) {
    return undefined
  }
  return regionFrom(rangedContentOf(script), attributesOf(rawContent, rangedContentOf(script)), isModuleScript)
}

const attributesOf = (rawContent: string, range: { readonly start: number }): unknown =>
  openTagOf(rawContent, range.start)

const openTagOf = (rawContent: string, contentStart: number): string =>
  rawContent.substring(rawContent.lastIndexOf('<', contentStart - 1), contentStart)

const nodeTypeOf = (node: unknown): string | undefined => {
  const type = fieldOf(node, 'type')
  return isString(type) ? type : undefined
}

const isTagged = (node: unknown): boolean => {
  const type = nodeTypeOf(node)
  return type !== undefined && TEMPLATE_EXPRESSION_TYPES[type] === true
}

const isScriptTagged = (node: unknown): boolean => nodeTypeOf(node) === 'Element' && fieldOf(node, 'name') === 'script'

const scriptTextOf = (node: unknown): { readonly start: number; readonly end: number } | undefined => {
  const text = firstOf(fieldOf(node, 'children'))
  return isRanged(text) ? text : undefined
}

const elementTextOf = (node: unknown): { readonly start: number; readonly end: number } | undefined =>
  isScriptTagged(node) ? scriptTextOf(node) : undefined

const scriptElementRegion = (node: unknown): LocatedRegion | undefined => {
  const text = elementTextOf(node)
  return text === undefined ? undefined : regionFrom(text, fieldOf(node, 'attributes'), false)
}

const taggedExpressionOf = (node: unknown): unknown => isTagged(node) ? fieldOf(node, 'expression') : undefined

const expressionRegion = (node: unknown): LocatedRegion | undefined => {
  const expression = taggedExpressionOf(node)
  return isRanged(expression)
    ? { start: expression.start, end: expression.end, isExpression: true, scriptFormat: 'js', isModuleScript: false }
    : undefined
}

const htmlRootOf = (ast: unknown): unknown => {
  const html = fieldOf(ast, 'html')
  if (html == null) {
    throw new Error(HTML_MISSING)
  }
  return html
}

const collectTemplateRegions = (root: unknown, walk: SvelteWalkFn): readonly LocatedRegion[] => {
  const collected: LocatedRegion[] = []
  walk(root, {
    enter: (node: unknown): void => {
      appendRegion(collected, scriptElementRegion(node))
      appendRegion(collected, expressionRegion(node))
    },
  })
  return collected
}

const scriptRegionsOf = (
  rawContent: string,
  moduleScript: unknown,
  instanceScript: unknown,
): readonly LocatedRegion[] => {
  const regions: LocatedRegion[] = []
  appendRegion(regions, scriptNodeRegion(moduleScript, rawContent, true))
  appendRegion(regions, scriptNodeRegion(instanceScript, rawContent, false))
  return regions
}

const discoveredRegions = (
  walk: SvelteWalkFn,
  compiler: SvelteCompilerModule,
  rawContent: string,
): readonly LocatedRegion[] => {
  const ast: unknown = compiler.parse(rawContent, { filename: PARSE_FILENAME })
  return [
    ...scriptRegionsOf(rawContent, fieldOf(ast, 'module'), fieldOf(ast, 'instance')),
    ...collectTemplateRegions(htmlRootOf(ast), walk),
  ].toSorted(byStart)
}

const moduleRegionIndex = (regions: readonly LocatedRegion[]): number | undefined => {
  const index = regions.findIndex((region) => region.isModuleScript)
  return index === -1 ? undefined : index
}

interface Discovery {
  readonly regions: readonly LocatedRegion[]
  readonly moduleRegion: number | undefined
}

const discoveryOf = (walk: SvelteWalkFn, compiler: SvelteCompilerModule, rawContent: string): Discovery => {
  const regions = discoveredRegions(walk, compiler, rawContent)
  return { regions, moduleRegion: moduleRegionIndex(regions) }
}

const failureMessageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : NON_ERROR_FAILURE)

const regionOf = (rawContent: string, context: FrameworkContext, located: LocatedRegion): ScriptRegion => ({
  start: located.start,
  end: located.end,
  isExpression: located.isExpression,
  scriptAst: context.parseScript(rawContent.substring(located.start, located.end), located.scriptFormat),
})

const parsedDocument = (
  walk: SvelteWalkFn,
  compiler: SvelteCompilerModule,
  rawContent: string,
  context: FrameworkContext,
): FrameworkParseResult<EmbeddedDocument> => {
  try {
    const discovery = discoveryOf(walk, compiler, rawContent)
    return {
      kind: 'Parsed',
      value: {
        formatId: FORMAT_ID,
        rawContent,
        regions: discovery.regions.map((region) => regionOf(rawContent, context, region)),
      },
    }
  } catch (cause) {
    return { kind: 'ParseFailed', message: failureMessageOf(cause) }
  }
}

const isProgram = (value: unknown): value is Program => isRecord(value) && Array.isArray(value['body'])

const programOf = (value: unknown): Program => {
  if (!isProgram(value)) {
    throw new Error(PROGRAM_MISSING)
  }
  return value
}

const statementIdentity = (statement: Statement): string => `${statement.type}:${statement.start}:${statement.end}`

const matchesStatement = (present: Statement | undefined, expected: Statement): boolean =>
  present !== undefined && statementIdentity(present) === statementIdentity(expected)

const removePlacedHeader = (program: Program, header: readonly Statement[]): boolean => {
  const placed = header.every((expected, index) => matchesStatement(program.body.at(index), expected))
  if (!placed) {
    return false
  }
  program.body.splice(0, header.length)
  return true
}

const stripPlacedHeader = (program: Program, header: readonly Statement[]): boolean =>
  header.length === 0 ? false : removePlacedHeader(program, header)

const moduleProgramOf = (header: readonly Statement[]): Program => ({
  type: 'Program',
  sourceType: 'module',
  body: [...header],
  hashbang: null,
})

const shift = (region: ScriptRegion, offset: number): ScriptRegion => ({
  ...region,
  start: region.start + offset,
  end: region.end + offset,
})

const prependModuleScript = (document: EmbeddedDocument, header: readonly Statement[]): EmbeddedDocument => ({
  ...document,
  rawContent: `${SCRIPT_MODULE_BLOCK}${document.rawContent}`,
  regions: [
    {
      start: SCRIPT_MODULE_OPEN.length,
      end: SCRIPT_MODULE_OPEN.length,
      isExpression: false,
      scriptAst: moduleProgramOf(header),
    },
    ...document.regions.map((region) => shift(region, SCRIPT_MODULE_BLOCK.length)),
  ],
})

const moduleScriptOf = (
  document: EmbeddedDocument,
  moduleRegion: number | undefined,
): ScriptRegion | undefined => (moduleRegion === undefined ? undefined : document.regions.at(moduleRegion))

const headerIntoModuleScript = (
  document: EmbeddedDocument,
  moduleRegion: number | undefined,
  header: readonly Statement[],
): EmbeddedDocument => {
  const target = moduleScriptOf(document, moduleRegion)
  if (target === undefined) {
    return prependModuleScript(document, header)
  }
  programOf(target.scriptAst).body.unshift(...header)
  return document
}

const placedDocument = (
  document: EmbeddedDocument,
  walk: SvelteWalkFn,
  compiler: SvelteCompilerModule,
  context: FrameworkContext,
): EmbeddedDocument => {
  const header = context.instrumentationHeader()
  const stripped = document.regions.map((region) => stripPlacedHeader(programOf(region.scriptAst), header))
  if (!stripped.some((wasPlaced) => wasPlaced)) {
    return document
  }
  const discovery = discoveryOf(walk, compiler, document.rawContent)
  return headerIntoModuleScript(document, discovery.moduleRegion, header)
}

const printedRegion = (region: ScriptRegion, context: FrameworkContext): string => {
  const printed = context.printScript(programOf(region.scriptAst))
  return region.isExpression ? printed.slice(0, -1) : `${NEWLINE}${printed}${NEWLINE}`
}

const printedDocument = (document: EmbeddedDocument, context: FrameworkContext): string => {
  let printed = ''
  let cursor = 0
  for (const region of document.regions) {
    printed += document.rawContent.substring(cursor, region.start)
    printed += printedRegion(region, context)
    cursor = region.end
  }
  return printed + document.rawContent.substring(cursor)
}

const leadingCommentOf = (code: string): string | undefined => STARTING_COMMENT.exec(code)?.[0]

const afterHashbang = (code: string): string => {
  const newLineIndex = code.indexOf(NEWLINE)
  if (newLineIndex <= 0) {
    return code
  }
  return `${code.substring(0, newLineIndex)}${NEWLINE}${NO_CHECK}${NEWLINE}${code.substring(newLineIndex + 1)}`
}

const afterLeadingComment = (code: string): string => {
  const leadingComment = leadingCommentOf(code)
  if (leadingComment === undefined) {
    return `${NO_CHECK}${NEWLINE}${code}`
  }
  return `${leadingComment}${NEWLINE}${NO_CHECK}${NEWLINE}${code.substring(leadingComment.length)}`
}

const prefixWithNoCheck = (code: string): string =>
  code.startsWith('#') ? afterHashbang(code) : afterLeadingComment(code)

const noCheckedDocument = (content: string, regions: readonly LocatedRegion[]): string => {
  let spliced = ''
  let cursor = 0
  for (const region of regions) {
    spliced += content.substring(cursor, region.start)
    spliced += NEWLINE
    spliced += prefixWithNoCheck(content.substring(region.start, region.end))
    spliced += NEWLINE
    cursor = region.end
  }
  return spliced + content.substring(cursor)
}

const disableTypeChecksIn = (
  walk: SvelteWalkFn,
  compiler: SvelteCompilerModule,
  rawContent: string,
): FrameworkParseResult<string> => {
  try {
    const regions = discoveryOf(walk, compiler, rawContent).regions
    return { kind: 'Parsed', value: noCheckedDocument(rawContent, regions) }
  } catch (cause) {
    return { kind: 'ParseFailed', message: failureMessageOf(cause) }
  }
}

export const svelteFramework = (version: string, compiler: SvelteCompilerModule, walk: SvelteWalkFn): Framework => ({
  kind: 'Framework',
  name: FORMAT_NAME,
  claim: {
    formatId: FORMAT_ID,
    extensions: [...EXTENSIONS],
    language: LANGUAGE,
    ownerVersion: version,
    contractVersion: CONTRACT_VERSION,
  },
  parse: (rawContent, context) => parsedDocument(walk, compiler, rawContent, context),
  transform: (document, context) => placedDocument(document, walk, compiler, context),
  print: (document, context) => printedDocument(document, context),
  disableTypeChecks: (rawContent) => disableTypeChecksIn(walk, compiler, rawContent),
})
