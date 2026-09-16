import type { Program, Statement } from '@systemfsoftware/stryker-framework-interface'
import { FrameworkFailed } from '@systemfsoftware/stryker-js-language'
import type {
  EmbeddedDocument,
  FrameworkClaim,
  FrameworkContext,
  FrameworkService,
  ScriptFormat,
} from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import type { SvelteCompiler, SvelteScriptTag, SvelteWalkFn } from './compiler-resolution.js'

const FORMAT_ID = 'svelte'
const LANGUAGE = 'svelte'
const CONTRACT_VERSION = '1'
const EXTENSIONS: readonly string[] = ['.svelte']

const NEWLINE = '\n'
const PARSE_FILENAME = 'component.svelte'
const SCRIPT_MODULE_OPEN = '<script context="module">\n'
const SCRIPT_MODULE_BLOCK = `${SCRIPT_MODULE_OPEN}\n</script>\n`

const INSTANCE_RANGE_MISSING = 'Svelte instance script without a source range'
const MODULE_RANGE_MISSING = 'Svelte module script without a source range'

const TEMPLATE_EXPRESSION_TYPES: Readonly<Record<string, true>> = {
  MustacheTag: true,
  RawMustacheTag: true,
  IfBlock: true,
  ConstTag: true,
  EachBlock: true,
  AwaitBlock: true,
  KeyBlock: true,
  EventHandler: true,
}

const claim: FrameworkClaim = {
  formatId: FORMAT_ID,
  extensions: [...EXTENSIONS],
  language: LANGUAGE,
  contractVersion: CONTRACT_VERSION,
}

const STATE = Symbol('svelte-format-state')

interface SvelteRegion {
  start: number
  end: number
  isExpression: boolean
  scriptAst?: unknown
}

interface SvelteFormatState {
  rawContent: string
  regions: SvelteRegion[]
  moduleRegion: number | undefined
}

interface SvelteFormatDocument extends EmbeddedDocument {
  readonly [STATE]: SvelteFormatState
}

interface TemplateRange {
  readonly start: number
  readonly end: number
  readonly isExpression: boolean
}

interface TemplateScriptRange extends TemplateRange {
  readonly format: ScriptFormat
}

interface RemappedScript {
  readonly range: TemplateRange
  readonly scriptRange: TemplateScriptRange
  readonly hadScript: boolean
}

interface RangeRemap {
  readonly placeholderLength: number
  readonly contentLength: number
  readonly format: ScriptFormat
  readonly hadScript: boolean
}

interface DiscoveredRegion {
  readonly start: number
  readonly end: number
  readonly isExpression: boolean
  readonly scriptFormat: ScriptFormat
}

interface DiscoveredScriptRange {
  readonly range: TemplateScriptRange
  readonly module: boolean
}

interface Discovery {
  readonly regions: readonly DiscoveredRegion[]
  readonly moduleRegion: number | undefined
}

interface ReplacedScripts {
  readonly replacedCode: string
  readonly scriptMap: ReadonlyMap<string, SvelteScriptTag>
}

const hasField = (value: unknown, key: string): value is { readonly [field: PropertyKey]: unknown } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (record) => key in record),
    Match.orElse(() => false),
  )

const hasContent = (value: unknown): value is { readonly content: unknown } => hasField(value, 'content')

const hasHtml = (value: unknown): value is { readonly html: unknown } => hasField(value, 'html')

const isScriptTagRecord = (
  value: unknown,
): value is { readonly content: unknown; readonly attributes: unknown } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (tag) => 'content' in tag),
    Match.orElse(() => false),
  )

const fieldOf = (value: unknown, key: string): unknown =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (record) => record[key]),
    Match.orElse(() => undefined),
  )

const hasNumericRange = (value: { readonly [field: PropertyKey]: unknown }): boolean =>
  areNumbers(value['start']) && areNumbers(value['end'])

const areNumbers = (value: unknown): boolean => typeof value === 'number'

const isRange = (value: unknown): value is { readonly start: number; readonly end: number } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (record) => hasNumericRange(record)),
    Match.orElse(() => false),
  )

const isTypedRecord = (value: unknown): value is { readonly type: string } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (record) => Predicate.isString(record['type'])),
    Match.orElse(() => false),
  )

const isTagged = (value: unknown, type: string): value is { readonly [field: PropertyKey]: unknown } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (record) => record['type'] === type),
    Match.orElse(() => false),
  )

const isScriptElement = (value: unknown): value is { readonly [field: PropertyKey]: unknown } =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (element) => element['type'] === 'Element' && element['name'] === 'script'),
    Match.orElse(() => false),
  )

const isTextRange = (value: unknown): value is TemplateRange =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (text) => isTagged(text, 'Text') && hasNumericRange(text)),
    Match.orElse(() => false),
  )

const isTemplateExpressionTag = (value: unknown): value is { readonly [field: PropertyKey]: unknown } =>
  Match.value(value).pipe(
    Match.when(isTypedRecord, (record) => TEMPLATE_EXPRESSION_TYPES[record.type] === true),
    Match.orElse(() => false),
  )

const isRangedBaseNode = (value: unknown): value is TemplateRange =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (node) => isTypedRecord(node) && hasNumericRange(node)),
    Match.orElse(() => false),
  )

const isNonEmptyArray = (value: unknown): value is readonly unknown[] => Array.isArray(value) && value.length > 0

const appendIfDefined = <A>(values: A[], value: A | undefined): void => {
  if (value !== undefined) {
    values.push(value)
  }
}

const programOf = (value: unknown): Program => {
  if (!isProgram(value)) {
    throw new Error('A script region without its parsed program cannot be printed')
  }
  return value
}

const isProgram = (value: unknown): value is Program =>
  Match.value(value).pipe(
    Match.when(Predicate.isObject, (program) => Array.isArray(program['body'])),
    Match.orElse(() => false),
  )

const scriptFormatOf = (tag: SvelteScriptTag): ScriptFormat =>
  Match.value(tag.lang).pipe(
    Match.when('ts', (): ScriptFormat => 'ts'),
    Match.orElse((): ScriptFormat => 'js'),
  )

const contentTextOf = (content: unknown): string =>
  Match.value(content).pipe(
    Match.when(Predicate.isString, (text) => text),
    Match.orElse(() => ''),
  )

const langOf = (attributes: unknown): unknown => fieldOf(attributes, 'lang')

const scriptTagOf = (script: unknown): SvelteScriptTag | undefined =>
  Match.value(script).pipe(
    Match.when(isScriptTagRecord, (tag) => ({
      content: contentTextOf(tag.content),
      lang: langOf(tag.attributes),
    })),
    Match.orElse(() => undefined),
  )

const scriptChild = (node: unknown): unknown =>
  Match.value(node).pipe(
    Match.when(isScriptElement, (element) =>
      Match.value(element['children']).pipe(
        Match.when(isNonEmptyArray, (children) => Option.getOrUndefined(Option.fromNullishOr(children.at(0)))),
        Match.orElse(() => undefined),
      )),
    Match.orElse(() => undefined),
  )

const tryGetScriptRangeFromElement = (node: unknown): TemplateRange | undefined =>
  Match.value(scriptChild(node)).pipe(
    Match.when(isTextRange, (range) => ({ start: range.start, end: range.end, isExpression: false })),
    Match.orElse(() => undefined),
  )

const rangedExpressionOf = (payload: unknown): TemplateRange | undefined =>
  Match.value(payload).pipe(
    Match.when(isRangedBaseNode, (expression) => ({
      start: expression.start,
      end: expression.end,
      isExpression: true,
    })),
    Match.orElse(() => undefined),
  )

const templateExpressionRange = (node: unknown): TemplateRange | undefined =>
  Match.value(node).pipe(
    Match.when(isTemplateExpressionTag, (tag) => rangedExpressionOf(tag['expression'])),
    Match.orElse(() => undefined),
  )

const scriptContentRange = (content: unknown, missingRange: string): TemplateRange =>
  Match.value(content).pipe(
    Match.when(isRange, (range) => ({ start: range.start, end: range.end, isExpression: false })),
    Match.orElse(() => {
      throw new Error(missingRange)
    }),
  )

const instanceScriptRange = (ast: unknown): TemplateRange | undefined =>
  Match.value(fieldOf(ast, 'instance')).pipe(
    Match.when(hasContent, (instance) => scriptContentRange(instance.content, INSTANCE_RANGE_MISSING)),
    Match.orElse(() => undefined),
  )

const moduleBlockRange = (block: unknown): TemplateRange =>
  Match.value(block).pipe(
    Match.when(hasContent, (module) => scriptContentRange(module.content, MODULE_RANGE_MISSING)),
    Match.orElse(() => {
      throw new Error(MODULE_RANGE_MISSING)
    }),
  )

const getModuleScriptRange = (ast: unknown): TemplateRange | undefined =>
  Match.value(fieldOf(ast, 'module')).pipe(
    Match.when(undefined, () => undefined),
    Match.when(null, () => undefined),
    Match.orElse((block) => moduleBlockRange(block)),
  )

const htmlRootOf = (ast: unknown): unknown =>
  Match.value(ast).pipe(
    Match.when(hasHtml, (record) => record.html),
    Match.orElse(() => {
      throw new Error('Svelte AST without html')
    }),
  )

const getTemplateScriptRanges = (ast: unknown, walker: SvelteWalkFn): TemplateRange[] => {
  const ranges: TemplateRange[] = []
  appendIfDefined(ranges, instanceScriptRange(ast))
  walker(htmlRootOf(ast), {
    enter(node: unknown): void {
      appendIfDefined(ranges, tryGetScriptRangeFromElement(node))
      appendIfDefined(ranges, templateExpressionRange(node))
    },
  })
  return ranges
}

const replaceScripts = async (compiler: SvelteCompiler, code: string): Promise<ReplacedScripts> => {
  const scriptMap = new Map<string, SvelteScriptTag>()
  let scriptIndex = 0
  const result = await compiler.preprocess(code, {
    script: (script) => {
      const scriptName = `script${scriptIndex++}`
      const tag = scriptTagOf(script)
      if (tag !== undefined) {
        scriptMap.set(scriptName, tag)
      }
      return { code: scriptName }
    },
  })
  return { replacedCode: result.code, scriptMap }
}

const remapRange = (
  range: TemplateRange,
  code: string,
  scriptMap: ReadonlyMap<string, SvelteScriptTag>,
): RangeRemap => {
  const placeholder = code.substring(range.start, range.end)
  return Match.value(scriptMap.get(placeholder)).pipe(
    Match.when(Predicate.isNotNullish, (script): RangeRemap => ({
      placeholderLength: placeholder.length,
      contentLength: script.content.length,
      format: scriptFormatOf(script),
      hadScript: true,
    })),
    Match.orElse((): RangeRemap => ({
      placeholderLength: placeholder.length,
      contentLength: placeholder.length,
      format: 'js',
      hadScript: false,
    })),
  )
}

const remapInOrder = (
  ranges: readonly TemplateRange[],
  code: string,
  scriptMap: ReadonlyMap<string, SvelteScriptTag>,
): RemappedScript[] => {
  let offset = 0
  return ranges.map((range) => {
    const remap = remapRange(range, code, scriptMap)
    const start = range.start + offset
    offset += remap.contentLength - remap.placeholderLength
    return {
      range,
      scriptRange: {
        start,
        end: start + remap.contentLength,
        isExpression: range.isExpression,
        format: remap.format,
      },
      hadScript: remap.hadScript,
    }
  })
}

const remappedModuleScript = (
  remapped: readonly RemappedScript[],
  moduleScriptRange: TemplateRange | undefined,
): TemplateScriptRange | undefined =>
  Option.getOrUndefined(
    Option.map(
      Option.fromNullishOr(remapped.find((script) => script.range === moduleScriptRange && script.hadScript)),
      (script) => script.scriptRange,
    ),
  )

const remapScriptLocations = (
  code: string,
  scriptMap: ReadonlyMap<string, SvelteScriptTag>,
  moduleScriptRange: TemplateRange | undefined,
  templateRanges: readonly TemplateRange[],
): {
  readonly remappedModuleScriptRange: TemplateScriptRange | undefined
  readonly remappedScriptRanges: readonly TemplateScriptRange[]
} => {
  const ordered = [moduleScriptRange, ...templateRanges]
    .filter(Predicate.isNotNullish)
    .sort((left, right) => left.start - right.start)
  const remapped = remapInOrder(ordered, code, scriptMap)
  const remappedModuleScriptRange = remappedModuleScript(remapped, moduleScriptRange)
  return {
    remappedModuleScriptRange,
    remappedScriptRanges: remapped
      .map((script) => script.scriptRange)
      .filter((range) => range !== remappedModuleScriptRange),
  }
}

const discoveredRegion = (range: TemplateScriptRange): DiscoveredRegion => ({
  start: range.start,
  end: range.end,
  isExpression: range.isExpression,
  scriptFormat: range.format,
})

const moduleIndexOf = (scriptRanges: readonly DiscoveredScriptRange[]): number | undefined => {
  const index = scriptRanges.findIndex((script) => script.module)
  return Match.value(index).pipe(
    Match.when(-1, () => undefined),
    Match.orElse(() => index),
  )
}

const markedRanges = (
  moduleScriptRange: TemplateScriptRange | undefined,
  scriptRanges: readonly TemplateScriptRange[],
): readonly DiscoveredScriptRange[] =>
  Match.value(moduleScriptRange).pipe(
    Match.when(Predicate.isNotNullish, (module): readonly DiscoveredScriptRange[] => [
      { range: module, module: true },
      ...scriptRanges.map((range) => ({ range, module: false })),
    ]),
    Match.orElse((): readonly DiscoveredScriptRange[] => scriptRanges.map((range) => ({ range, module: false }))),
  )

const discoveryOf = (
  moduleScriptRange: TemplateScriptRange | undefined,
  scriptRanges: readonly TemplateScriptRange[],
): Discovery => {
  const marked = [...markedRanges(moduleScriptRange, scriptRanges)]
    .sort((left, right) => left.range.start - right.range.start)
  return {
    regions: marked.map((script) => discoveredRegion(script.range)),
    moduleRegion: moduleIndexOf(marked),
  }
}

const discoverRegions = async (compiler: SvelteCompiler, text: string): Promise<Discovery> => {
  const { replacedCode, scriptMap } = await replaceScripts(compiler, text)
  const svelteAst: unknown = compiler.parse(replacedCode, { filename: PARSE_FILENAME })
  const moduleScriptRange = getModuleScriptRange(svelteAst)
  const templateRanges = getTemplateScriptRanges(svelteAst, compiler.walk)
  const { remappedModuleScriptRange, remappedScriptRanges } = remapScriptLocations(
    replacedCode,
    scriptMap,
    moduleScriptRange,
    templateRanges,
  )
  return discoveryOf(remappedModuleScriptRange, remappedScriptRanges)
}

const regionOf = (rawContent: string, context: FrameworkContext, region: DiscoveredRegion): SvelteRegion => ({
  start: region.start,
  end: region.end,
  isExpression: region.isExpression,
  scriptAst: context.parseScript(rawContent.substring(region.start, region.end), region.scriptFormat),
})

const documentOf = async (
  compiler: SvelteCompiler,
  rawContent: string,
  context: FrameworkContext,
): Promise<SvelteFormatDocument> => {
  const discovery = await discoverRegions(compiler, rawContent)
  const regions = discovery.regions.map((region) => regionOf(rawContent, context, region))
  return {
    formatId: FORMAT_ID,
    rawContent,
    regions,
    [STATE]: { rawContent, regions, moduleRegion: discovery.moduleRegion },
  }
}

const documentFromState = (state: SvelteFormatState): SvelteFormatDocument => ({
  formatId: FORMAT_ID,
  rawContent: state.rawContent,
  regions: state.regions,
  [STATE]: state,
})

const hasState = (document: EmbeddedDocument): document is SvelteFormatDocument => STATE in document

const stateOf = (document: EmbeddedDocument): SvelteFormatState | undefined =>
  Match.value(document).pipe(
    Match.when(hasState, (carrier) => carrier[STATE]),
    Match.orElse(() => undefined),
  )

const invalidDocument = (): FrameworkFailed =>
  new FrameworkFailed({
    reason: 'InvalidContribution',
    cause: 'a svelte document must come from the svelte format parse hook',
  })

const decodedState = (document: EmbeddedDocument): Effect.Effect<SvelteFormatState, FrameworkFailed> =>
  Match.value(stateOf(document)).pipe(
    Match.when(Predicate.isNotNullish, (state) => Effect.succeed(state)),
    Match.orElse(() => Effect.fail(invalidDocument())),
  )

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

const NON_ERROR_FAILURE = 'the svelte compiler reported a failure that is not an Error'

const spanText = (statement: Statement): string =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(statement.range), (range) => `${range[0]}:${range[1]}`),
    () => `${statement.start}-${statement.end}`,
  )

const statementIdentity = (statement: Statement): string => `${statement.type}:${spanText(statement)}`

const matchesStatement = (present: Statement | undefined, expected: Statement): boolean =>
  Match.value(present).pipe(
    Match.when(Predicate.isNotNullish, (statement) => statementIdentity(statement) === statementIdentity(expected)),
    Match.orElse(() => false),
  )

const removePlacedHeader = (program: Program, header: readonly Statement[]): boolean =>
  Match.value(header.every((expected, index) => matchesStatement(program.body.at(index), expected))).pipe(
    Match.when(true, () => {
      program.body.splice(0, header.length)
      return true
    }),
    Match.orElse(() => false),
  )

const stripPlacedHeader = (program: Program, header: readonly Statement[]): boolean =>
  Match.value(header.length === 0).pipe(
    Match.when(true, () => false),
    Match.orElse(() => removePlacedHeader(program, header)),
  )

const moduleRegionOf = (state: SvelteFormatState): SvelteRegion | undefined =>
  Match.value(state.moduleRegion).pipe(
    Match.when(Predicate.isNotNullish, (index) => state.regions[index]),
    Match.orElse(() => undefined),
  )

const moduleProgramOf = (header: readonly Statement[]): Program => ({
  type: 'Program',
  sourceType: 'module',
  body: [...header],
  hashbang: null,
})

const prependModuleRegion = (state: SvelteFormatState, header: readonly Statement[]): void => {
  const shift = SCRIPT_MODULE_BLOCK.length
  state.regions = [
    {
      start: SCRIPT_MODULE_OPEN.length,
      end: SCRIPT_MODULE_OPEN.length,
      isExpression: false,
      scriptAst: moduleProgramOf(header),
    },
    ...state.regions.map((region) => ({
      start: region.start + shift,
      end: region.end + shift,
      isExpression: region.isExpression,
      scriptAst: region.scriptAst,
    })),
  ]
  state.rawContent = `${SCRIPT_MODULE_BLOCK}${state.rawContent}`
}

const appendHeader = (region: SvelteRegion, header: readonly Statement[]): void => {
  programOf(region.scriptAst).body.unshift(...header)
}

const placeModuleHeader = (state: SvelteFormatState, context: FrameworkContext): void => {
  const header = context.instrumentationHeader()
  const stripped = state.regions.map((region) => stripPlacedHeader(programOf(region.scriptAst), header))
  if (!stripped.some((wasPlaced) => wasPlaced)) {
    return
  }
  Match.value(moduleRegionOf(state)).pipe(
    Match.when(Predicate.isNotNullish, (region) => appendHeader(region, header)),
    Match.orElse(() => prependModuleRegion(state, header)),
  )
}

const printedRegionCode = (region: SvelteRegion, context: FrameworkContext): string =>
  context.printScript(programOf(region.scriptAst))

const printedExpression = (region: SvelteRegion, context: FrameworkContext): string =>
  printedRegionCode(region, context).slice(0, -1)

const printedStatement = (region: SvelteRegion, context: FrameworkContext): string =>
  `${NEWLINE}${printedRegionCode(region, context)}${NEWLINE}`

const printedRegion = (region: SvelteRegion, context: FrameworkContext): string =>
  Match.value(region.isExpression).pipe(
    Match.when(true, () => printedExpression(region, context)),
    Match.orElse(() => printedStatement(region, context)),
  )

const printedDocument = (state: SvelteFormatState, context: FrameworkContext): string => {
  let printed = ''
  let cursor = 0
  for (const region of state.regions) {
    printed += state.rawContent.substring(cursor, region.start)
    printed += printedRegion(region, context)
    cursor = region.end
  }
  return printed + state.rawContent.substring(cursor)
}

const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

const leadingCommentOf = (code: string): string | undefined => STARTING_COMMENT.exec(code)?.[0]

const afterHashbang = (code: string): string => {
  const newLineIndex = code.indexOf(NEWLINE)
  if (newLineIndex <= 0) {
    return code
  }
  return `${code.substring(0, newLineIndex)}${NEWLINE}// @ts-nocheck${NEWLINE}${code.substring(newLineIndex + 1)}`
}

const afterLeadingComment = (code: string): string => {
  const leadingComment = leadingCommentOf(code)
  if (leadingComment === undefined) {
    return `// @ts-nocheck${NEWLINE}${code}`
  }
  return `${leadingComment}${NEWLINE}// @ts-nocheck${NEWLINE}${code.substring(leadingComment.length)}`
}

const prefixWithNoCheck = (code: string): string =>
  Match.value(code.startsWith('#')).pipe(
    Match.when(true, () => afterHashbang(code)),
    Match.orElse(() => afterLeadingComment(code)),
  )

const noCheckDocument = (content: string, regions: readonly DiscoveredRegion[]): string => {
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

const parsedDocument = (
  compiler: SvelteCompiler,
  rawContent: string,
  context: FrameworkContext,
): Effect.Effect<EmbeddedDocument, FrameworkFailed> =>
  Effect.tryPromise({
    try: () => documentOf(compiler, rawContent, context),
    catch: toFrameworkFailed,
  })

const transformedDocument = (
  document: EmbeddedDocument,
  context: FrameworkContext,
): Effect.Effect<EmbeddedDocument, FrameworkFailed> =>
  Effect.flatMap(decodedState(document), (state) =>
    Effect.sync(() => {
      placeModuleHeader(state, context)
      return documentFromState(state)
    }))

const renderedDocument = (
  document: EmbeddedDocument,
  context: FrameworkContext,
): Effect.Effect<string, FrameworkFailed> =>
  Effect.flatMap(
    decodedState(document),
    (state) => Effect.try({ try: () => printedDocument(state, context), catch: toFrameworkFailed }),
  )

const disableTypeChecksInDocument = (
  compiler: SvelteCompiler,
  content: string,
): Effect.Effect<string, FrameworkFailed> =>
  Effect.tryPromise({
    try: async () => noCheckDocument(content, (await discoverRegions(compiler, content)).regions),
    catch: toFrameworkFailed,
  })

export const svelteFormatService = (compiler: SvelteCompiler): FrameworkService => ({
  claim,
  parse: (rawContent, context) => parsedDocument(compiler, rawContent, context),
  transform: (document, context) => transformedDocument(document, context),
  print: (document, context) => renderedDocument(document, context),
  disableTypeChecks: (content) => disableTypeChecksInDocument(compiler, content),
})
