import type { Program, ScriptRegion } from '@systemfsoftware/stryker-framework-interface'
import { FrameworkFailed } from '@systemfsoftware/stryker-js-language'
import type {
  EmbeddedDocument,
  FrameworkClaim,
  FrameworkContext,
  FrameworkService,
  ScriptFormat,
} from '@systemfsoftware/stryker-js-language'
import { type Ast as NGAst, parse, type ParseTreeResult, visitAll } from 'angular-html-parser'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'

/**
 * The Angular format: HTML templates, and single-file components that keep
 * their script in an HTML `<script>` tag. Only embedded script regions are
 * claimed — template expressions are never parsed, never mutated, and never
 * printed — which is why every region carries `isExpression: false`.
 *
 * The core owns the pipeline around these hooks: it slices each region, parses
 * the slice through the toolkit context, mutates the resulting AST in place,
 * and hands the document back to `print` to be framed into the raw content. The
 * hooks here are therefore only the two things the core cannot know: where the
 * script regions are, and how the mutation survives the trip back into the
 * document.
 */
const FORMAT_ID = 'html'
const LANGUAGE = 'html'
const CONTRACT_VERSION = '1'
const EXTENSIONS: readonly string[] = ['.html', '.htm', '.vue']

const SCRIPT_TAG = 'script'
const SRC_ATTRIBUTE = 'src'
const TYPE_ATTRIBUTE = 'type'
const LANG_ATTRIBUTE = 'lang'
const DEFAULT_SCRIPT_FORMAT: ScriptFormat = 'js'
const NEWLINE = '\n'

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

const claim: FrameworkClaim = {
  formatId: FORMAT_ID,
  extensions: [...EXTENSIONS],
  language: LANGUAGE,
  contractVersion: CONTRACT_VERSION,
}

interface ScriptLocation {
  readonly start: number
  readonly end: number
  readonly scriptFormat: ScriptFormat
}

const scriptLocations = (document: string): readonly ScriptLocation[] => {
  const { rootNodes, errors } = parse(document, PARSE_OPTIONS)
  const failure = parseFailure(errors)
  if (failure !== undefined) {
    throw failure
  }
  return collectScripts(rootNodes, document)
}

const parseFailure = (errors: readonly ParseTreeResult['errors'][number][]): FrameworkFailed | undefined => {
  const first = errors.at(0)
  if (first === undefined) {
    return undefined
  }
  return new FrameworkFailed({ reason: first.msg, cause: first })
}

const collectScripts = (rootNodes: readonly NGAst.Node[], document: string): readonly ScriptLocation[] => {
  const collected: ScriptLocation[] = []
  const collector: NGAst.Visitor = {
    visitElement: (element, context) => {
      appendScriptLocation(element, document, collected)
      visitAll(collector, element.children, context)
    },
    visitAttribute: () => undefined,
    visitText: () => undefined,
    visitComment: () => undefined,
    visitDocType: () => undefined,
    visitExpansion: () => undefined,
    visitExpansionCase: () => undefined,
    visitBlock: () => undefined,
    visitBlockParameter: () => undefined,
    visitLetDeclaration: () => undefined,
    visitCdata: () => undefined,
    visitComponent: () => undefined,
    visitDirective: () => undefined,
  }
  visitAll(collector, [...rootNodes])
  return collected
}

const appendScriptLocation = (
  element: NGAst.Element,
  document: string,
  collected: ScriptLocation[],
): void => {
  const scriptFormat = scriptFormatOf(element)
  if (scriptFormat !== undefined) {
    collected.push(scriptLocation(element, scriptFormat))
  }
}

const scriptLocation = (element: NGAst.Element, scriptFormat: ScriptFormat): ScriptLocation => {
  const endSourceSpan = element.endSourceSpan
  if (endSourceSpan == null) {
    throw new Error('HTML element without an end source span')
  }
  return {
    start: element.startSourceSpan.end.offset,
    end: endSourceSpan.start.offset,
    scriptFormat,
  }
}

const scriptFormatOf = (element: NGAst.Element): ScriptFormat | undefined =>
  Match.value(element).pipe(
    Match.when(isScriptTag, (script) => scriptTypeFormat(script)),
    Match.orElse(() => undefined),
  )

const isScriptTag = (element: NGAst.Element): boolean =>
  element.name === SCRIPT_TAG && !element.attrs.some((attribute) => attribute.name === SRC_ATTRIBUTE)

const scriptTypeFormat = (element: NGAst.Element): ScriptFormat | undefined => {
  const attribute = scriptTypeAttribute(element)
  if (attribute === undefined) {
    return DEFAULT_SCRIPT_FORMAT
  }
  return SCRIPT_TYPE_FORMATS[attribute.value.toLowerCase()]
}

const scriptTypeAttribute = (element: NGAst.Element): NGAst.Attribute | undefined => {
  const typeAttribute = element.attrs.find((attribute) => attribute.name === TYPE_ATTRIBUTE)
  if (typeAttribute !== undefined) {
    return typeAttribute
  }
  return element.attrs.find((attribute) => attribute.name === LANG_ATTRIBUTE)
}

const byStart = (left: { readonly start: number }, right: { readonly start: number }): number =>
  left.start - right.start

const sliceOf = (document: string, region: { readonly start: number; readonly end: number }): string =>
  document.substring(region.start, region.end)

const regionOf = (rawContent: string, context: FrameworkContext, location: ScriptLocation): ScriptRegion => ({
  start: location.start,
  end: location.end,
  isExpression: false,
  scriptAst: context.parseScript(sliceOf(rawContent, location), location.scriptFormat),
})

const documentOf = (rawContent: string, context: FrameworkContext): EmbeddedDocument => ({
  formatId: FORMAT_ID,
  rawContent,
  regions: scriptLocations(rawContent).map((location) => regionOf(rawContent, context, location)),
})

const isProgram = (value: unknown): value is Program =>
  Predicate.isObject(value) && Array.isArray(Reflect.get(value, 'body'))

const programOf = (value: unknown): Program => {
  if (!isProgram(value)) {
    throw new Error('A script region without its parsed program cannot be printed')
  }
  return value
}

const printedDocument = (document: EmbeddedDocument, context: FrameworkContext): string => {
  let printed = ''
  let cursor = 0
  for (const region of [...document.regions].sort(byStart)) {
    printed += document.rawContent.substring(cursor, region.start)
    printed += NEWLINE
    printed += context.printScript(programOf(region.scriptAst))
    printed += NEWLINE
    cursor = region.end
  }
  return printed + document.rawContent.substring(cursor)
}

const noCheckDocument = (content: string): string => {
  let spliced = ''
  let cursor = 0
  for (const location of [...scriptLocations(content)].sort(byStart)) {
    spliced += content.substring(cursor, location.start)
    spliced += NEWLINE
    spliced += prefixWithNoCheck(sliceOf(content, location))
    spliced += NEWLINE
    cursor = location.end
  }
  return spliced + content.substring(cursor)
}

const toFrameworkFailed = (cause: unknown): FrameworkFailed =>
  Match.value(cause).pipe(
    Match.when(
      (subject: unknown): subject is FrameworkFailed => subject instanceof FrameworkFailed,
      (failure: FrameworkFailed) => failure,
    ),
    Match.orElse(() => new FrameworkFailed({ reason: reasonOf(cause), cause })),
  )

const reasonOf = (cause: unknown): string =>
  Match.value(cause).pipe(
    Match.when((subject: unknown): subject is Error => subject instanceof Error, (error) => error.message),
    Match.orElse(() => NON_ERROR_FAILURE),
  )

const NON_ERROR_FAILURE = 'the Angular parser reported a failure that is not an Error'

const unchangedDocument = (document: EmbeddedDocument): Effect.Effect<EmbeddedDocument, FrameworkFailed> =>
  Effect.succeed(document)

const disableTypeChecksInDocument = (content: string): Effect.Effect<string, FrameworkFailed> =>
  Effect.try({ try: () => noCheckDocument(content), catch: toFrameworkFailed })

const parsedDocument = (
  rawContent: string,
  context: FrameworkContext,
): Effect.Effect<EmbeddedDocument, FrameworkFailed> =>
  Effect.try({ try: () => documentOf(rawContent, context), catch: toFrameworkFailed })

const renderedDocument = (
  document: EmbeddedDocument,
  context: FrameworkContext,
): Effect.Effect<string, FrameworkFailed> =>
  Effect.try({ try: () => printedDocument(document, context), catch: toFrameworkFailed })

export const angularFormatService: FrameworkService = {
  claim,
  parse: parsedDocument,
  transform: unchangedDocument,
  print: renderedDocument,
  disableTypeChecks: disableTypeChecksInDocument,
}

const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

function prefixWithNoCheck(code: string): string {
  if (code.startsWith('#')) {
    return afterHashbang(code)
  }
  return afterLeadingComment(code)
}

function afterHashbang(code: string): string {
  const newLineIndex = code.indexOf(NEWLINE)
  if (newLineIndex <= 0) {
    return code
  }
  return `${code.substring(0, newLineIndex)}${NEWLINE}// @ts-nocheck${NEWLINE}${code.substring(newLineIndex + 1)}`
}

const leadingCommentOf = (code: string): string | undefined => STARTING_COMMENT.exec(code)?.[0]

function afterLeadingComment(code: string): string {
  const leadingComment = leadingCommentOf(code)
  if (leadingComment === undefined) {
    return `// @ts-nocheck${NEWLINE}${code}`
  }
  return `${leadingComment}${NEWLINE}// @ts-nocheck${NEWLINE}${code.substring(leadingComment.length)}`
}
