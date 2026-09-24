import type {
  EmbeddedDocument,
  FormatId,
  Framework,
  FrameworkClaim,
  FrameworkContext,
  FrameworkParseResult,
  ScriptFormat,
} from '@systemfsoftware/stryker-framework-interface'
import { type Ast as NGAst, parse, type ParseTreeResult, visitAll } from 'angular-html-parser'
import parserManifest from 'angular-html-parser/package.json' with { type: 'json' }

/**
 * The Angular format: HTML templates and single-file components that keep
 * their script inside an HTML `<script>` tag. Only embedded script regions
 * are claimed — template expressions are never parsed, never mutated, and
 * never printed — which is why every region carries `isExpression: false`.
 *
 * The core owns the pipeline around these hooks: it slices each region,
 * parses the slice through the toolkit context, mutates the resulting
 * program, and hands the document back to `print` to be framed into the raw
 * content. The hooks here are only the two things the core cannot know:
 * where the script regions are, and how a mutation survives the trip back
 * into the document.
 */
const FORMAT_ID_TEXT = 'html'
const LANGUAGE = 'html'
const CONTRACT_VERSION = '1'
const EXTENSIONS = ['.html', '.htm', '.vue']

const SCRIPT_TAG = 'script'
const SRC_ATTRIBUTE = 'src'
const TYPE_ATTRIBUTE = 'type'
const LANG_ATTRIBUTE = 'lang'
const DEFAULT_SCRIPT_FORMAT: ScriptFormat = 'js'
const NEWLINE = '\n'
const NO_CHECK_COMMENT = '// @ts-nocheck'
const UNCLOSED_SCRIPT_MESSAGE = 'the script element never closes'
const NON_ERROR_FAILURE = 'the Angular parser reported a failure that is not an Error'

const PARSE_OPTIONS = {
  canSelfClose: true,
  allowHtmComponentClosingTags: true,
  isTagNameCaseSensitive: true,
}

const SCRIPT_TYPE_FORMATS: Readonly<Record<string, ScriptFormat>> = {
  tsx: 'tsx',
  'text/tsx': 'tsx',
  ts: 'ts',
  'text/typescript': 'ts',
  typescript: 'ts',
  js: 'js',
  'text/javascript': 'js',
  javascript: 'js',
  module: 'js',
}

const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

interface ScriptLocation {
  readonly start: number
  readonly end: number
  readonly scriptFormat: ScriptFormat
}

interface ScriptLocationFinding extends ScriptLocation {
  readonly kind: 'Location'
}

interface ScriptProblemFinding {
  readonly kind: 'Problem'
  readonly message: string
}
type ScriptFinding = ScriptLocationFinding | ScriptProblemFinding

type ParserError = ParseTreeResult['errors'][number]

const HTML_FORMAT_ID: FormatId = FORMAT_ID_TEXT

const claimOf = (ownerVersion: string): FrameworkClaim => ({
  formatId: HTML_FORMAT_ID,
  extensions: [...EXTENSIONS],
  language: LANGUAGE,
  ownerVersion,
  contractVersion: CONTRACT_VERSION,
})

const isScriptRegionTag = (element: NGAst.Element): boolean =>
  element.name === SCRIPT_TAG && !element.attrs.some((attribute) => attribute.name === SRC_ATTRIBUTE)

const scriptTypeAttribute = (element: NGAst.Element): NGAst.Attribute | undefined =>
  element.attrs.find((attribute) => attribute.name === TYPE_ATTRIBUTE) ??
    element.attrs.find((attribute) => attribute.name === LANG_ATTRIBUTE)

const scriptFormatOfAttribute = (attribute: NGAst.Attribute): ScriptFormat | undefined =>
  SCRIPT_TYPE_FORMATS[attribute.value.toLowerCase()]

const scriptFormatOfElement = (element: NGAst.Element): ScriptFormat | undefined => {
  const attribute = scriptTypeAttribute(element)
  return attribute === undefined ? DEFAULT_SCRIPT_FORMAT : scriptFormatOfAttribute(attribute)
}

const scriptFormatOf = (element: NGAst.Element): ScriptFormat | undefined =>
  isScriptRegionTag(element) ? scriptFormatOfElement(element) : undefined

const locationOf = (element: NGAst.Element, scriptFormat: ScriptFormat): ScriptFinding => {
  const endSpan = element.endSourceSpan
  return endSpan === null
    ? { kind: 'Problem', message: UNCLOSED_SCRIPT_MESSAGE }
    : {
      kind: 'Location',
      start: element.startSourceSpan.end.offset,
      end: endSpan.start.offset,
      scriptFormat,
    }
}

const appendLocation = (element: NGAst.Element, findings: ScriptFinding[]): void => {
  const scriptFormat = scriptFormatOf(element)
  if (scriptFormat !== undefined) {
    findings.push(locationOf(element, scriptFormat))
  }
}

const ignoreVisited = (): undefined => undefined

const collectorOf = (findings: ScriptFinding[]): NGAst.Visitor => {
  const walk: NGAst.Visitor = {
    visitElement: (element) => {
      appendLocation(element, findings)
      visitAll(walk, element.children)
    },
    visitAttribute: ignoreVisited,
    visitText: ignoreVisited,
    visitComment: ignoreVisited,
    visitDocType: ignoreVisited,
    visitExpansion: ignoreVisited,
    visitExpansionCase: ignoreVisited,
    visitBlock: ignoreVisited,
    visitBlockParameter: ignoreVisited,
    visitLetDeclaration: ignoreVisited,
    visitCdata: ignoreVisited,
    visitComponent: ignoreVisited,
    visitDirective: ignoreVisited,
  }
  return walk
}

const isProblem = (finding: ScriptFinding): finding is ScriptProblemFinding => finding.kind === 'Problem'

const isLocation = (finding: ScriptFinding): finding is ScriptLocationFinding => finding.kind === 'Location'

const reportedProblemOf = (
  findings: readonly ScriptFinding[],
  firstError: ParserError | undefined,
): ScriptProblemFinding | undefined =>
  firstError === undefined ? findings.find(isProblem) : { kind: 'Problem', message: firstError.msg }

const scriptFindings = (rootNodes: NGAst.Node[]): readonly ScriptFinding[] => {
  const findings: ScriptFinding[] = []
  visitAll(collectorOf(findings), rootNodes)
  return findings
}

const locationsOf = (rawContent: string): FrameworkParseResult<readonly ScriptLocation[]> => {
  const { rootNodes, errors } = parse(rawContent, PARSE_OPTIONS)
  const findings = scriptFindings(rootNodes)
  const problem = reportedProblemOf(findings, errors.at(0))
  return problem === undefined
    ? { kind: 'Parsed', value: findings.filter(isLocation) }
    : { kind: 'ParseFailed', message: problem.message }
}

const failureMessage = (cause: unknown): string => cause instanceof Error ? cause.message : NON_ERROR_FAILURE

const documentOf = (
  rawContent: string,
  context: FrameworkContext,
  locations: readonly ScriptLocation[],
): EmbeddedDocument => ({
  formatId: HTML_FORMAT_ID,
  rawContent,
  regions: locations.map((location) => ({
    start: location.start,
    end: location.end,
    isExpression: false,
    scriptAst: context.parseScript(rawContent.substring(location.start, location.end), location.scriptFormat),
  })),
})

const documentResult = (
  rawContent: string,
  context: FrameworkContext,
): FrameworkParseResult<EmbeddedDocument> => {
  const locations = locationsOf(rawContent)
  return locations.kind === 'Parsed'
    ? { kind: 'Parsed', value: documentOf(rawContent, context, locations.value) }
    : locations
}

const parseDocument = (rawContent: string, context: FrameworkContext): FrameworkParseResult<EmbeddedDocument> => {
  try {
    return documentResult(rawContent, context)
  } catch (cause) {
    return { kind: 'ParseFailed', message: failureMessage(cause) }
  }
}

const unchangedDocument = (document: EmbeddedDocument): EmbeddedDocument => document

const byStart = (left: { readonly start: number }, right: { readonly start: number }): number =>
  left.start - right.start

const printedDocument = (document: EmbeddedDocument, context: FrameworkContext): string => {
  let printed = ''
  let cursor = 0
  for (const region of document.regions.toSorted(byStart)) {
    printed += document.rawContent.substring(cursor, region.start)
    printed += context.printScript(region.scriptAst)
    cursor = region.end
  }
  return printed + document.rawContent.substring(cursor)
}

const afterHashbang = (code: string): string => {
  const newLineIndex = code.indexOf(NEWLINE)
  return newLineIndex <= 0
    ? code
    : `${code.substring(0, newLineIndex)}${NEWLINE}${NO_CHECK_COMMENT}${NEWLINE}${code.substring(newLineIndex + 1)}`
}

const leadingCommentOf = (code: string): string | undefined => STARTING_COMMENT.exec(code)?.[0]

const afterLeadingComment = (code: string): string => {
  const leadingComment = leadingCommentOf(code)
  return leadingComment === undefined
    ? `${NO_CHECK_COMMENT}${NEWLINE}${code}`
    : `${leadingComment}${NEWLINE}${NO_CHECK_COMMENT}${NEWLINE}${code.substring(leadingComment.length)}`
}

const noCheckedScript = (code: string): string => code.startsWith('#') ? afterHashbang(code) : afterLeadingComment(code)

const withNoCheckSplices = (rawContent: string, locations: readonly ScriptLocation[]): string => {
  let spliced = ''
  let cursor = 0
  for (const location of locations) {
    spliced += rawContent.substring(cursor, location.start)
    spliced += noCheckedScript(rawContent.substring(location.start, location.end))
    cursor = location.end
  }
  return spliced + rawContent.substring(cursor)
}

const splicedResult = (rawContent: string): FrameworkParseResult<string> => {
  const locations = locationsOf(rawContent)
  return locations.kind === 'Parsed'
    ? { kind: 'Parsed', value: withNoCheckSplices(rawContent, locations.value) }
    : locations
}

const disableTypeChecksIn = (rawContent: string): FrameworkParseResult<string> => splicedResult(rawContent)

const angularFramework: Framework = {
  kind: 'Framework',
  name: 'angular',
  claim: claimOf(parserManifest.version),
  parse: parseDocument,
  transform: unchangedDocument,
  print: printedDocument,
  disableTypeChecks: disableTypeChecksIn,
}

export { angularFramework }
