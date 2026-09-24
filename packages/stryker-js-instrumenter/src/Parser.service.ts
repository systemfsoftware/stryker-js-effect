import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import type { Ast as NGAst, ParseTreeResult } from 'angular-html-parser'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type * as OxcModule from 'oxc-parser'
import type { Ast, AstByFormat, Range, ScriptAst, ScriptFormat, TemplateScript } from './Ast.schema.js'
import { LineTable, LineTableFromText } from './Location.schema.js'
import {
  HtmlEndSpanMissing,
  ParseFailed,
  ParserNotFound,
  SvelteHtmlMissing,
  SvelteParseFailed,
  SvelteRangeMissing,
  SvelteVersionNotSupported,
  SvelteWalkerNotFound,
} from './Parser.schema.js'
import type { AstFormat } from './Syntax.schema.js'

export interface ParserOptions {}

export type ParserError =
  | ParseFailed
  | ParserNotFound
  | SvelteParseFailed
  | SvelteVersionNotSupported
  | SvelteWalkerNotFound

export interface ParserShape {
  parse<T extends AstFormat>(
    code: string,
    fileName: string,
    formatOverride: T,
  ): Effect.Effect<AstByFormat[T], ParserError>
  parse(code: string, fileName: string, formatOverride?: AstFormat): Effect.Effect<Ast, ParserError>
  readonly formatOf: (fileName: string, formatOverride?: AstFormat) => AstFormat | undefined
}

export class Parser
  extends Context.Service<Parser, ParserShape>()('@systemfsoftware/stryker-js-instrumenter/Parser.service/Parser')
{
  static readonly layer: Layer.Layer<Parser> = Layer.effect(
    Parser,
    Effect.map(
      Effect.cached(Effect.map(Effect.promise(() => import('oxc-parser')), (oxc) => parserOf(oxc))),
      (loadParser) => parserLoadedOnFirstParse(loadParser),
    ),
  )
}

type Oxc = typeof OxcModule

interface PlainRecord<A = unknown> {
  readonly [k: string]: A
}

const isPlainRecord = <A = unknown>(value: unknown): value is PlainRecord<A> =>
  typeof value === 'object' && value !== null

const isTagged = (value: unknown, type: string): value is PlainRecord => isPlainRecord(value) && value['type'] === type

const hasNumericRange = (value: PlainRecord): value is PlainRecord & Range =>
  typeof value['start'] === 'number' && typeof value['end'] === 'number'

const isRange = (value: unknown): value is Range => isPlainRecord(value) && hasNumericRange(value)

const isTypedRecord = (value: unknown): value is PlainRecord & { type: string } =>
  isPlainRecord(value) && Predicate.isString(value['type'])

const isRangedBaseNode = (value: unknown): value is Node & Range => isTypedRecord(value) && hasNumericRange(value)

const isNonEmptyArray = <A = unknown>(value: unknown): value is Array<A> => Array.isArray(value) && value.length > 0

const hasContentField = <A = unknown>(value: unknown): value is PlainRecord<A> & { readonly content: A } =>
  isPlainRecord<A>(value) && 'content' in value

const hasHtmlField = <B = unknown>(value: unknown): value is PlainRecord & { readonly html: B } =>
  isPlainRecord(value) && 'html' in value

const readRecordField = <B = unknown>(record: PlainRecord<B>, key: string): B | undefined => record[key]

const fieldOf = <A = unknown, B = unknown>(value: A, key: string) =>
  Option.getOrUndefined(
    Option.filter(Option.some(value), isPlainRecord<B>).pipe(Option.map((record) => readRecordField(record, key))),
  )

const parseWithOxcOf = (oxc: Oxc) => (text: string, fileName: string, lang: 'js' | 'jsx' | 'ts' | 'tsx') =>
  Effect.gen(function*() {
    const result = oxc.parseSync(fileName, text, { lang, range: true })
    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(text))
    return yield* Option.match(oxcParseFailure(oxc, result.errors, fileName, lineTable), {
      onSome: Effect.fail,
      onNone: () => Effect.succeed({ root: result.program, comments: result.comments }),
    })
  })

const oxcParseFailure = (oxc: Oxc, errors: readonly OxcModule.OxcError[], fileName: string, lineTable: LineTable) =>
  Option.map(Arr.head(errors), (first) =>
    ParseFailed.make({
      fileName,
      message: first.message,
      location: lineTable.positionAt(oxcErrorLabelStart(first)),
      cause: errors.map((reported) => reported.message),
    }))

const oxcErrorLabelStart = (error: OxcModule.OxcError) =>
  Option.match(Arr.head(error.labels), {
    onNone: () => 0,
    onSome: (label) => label.start,
  })

const shiftScriptOffsets = (ast: Ast, offset: number) =>
  Match.value(ast.root).pipe(
    Match.when(isRange, (root) => {
      root.start += offset
      root.end += offset
    }),
    Match.orElse(() => ast.root),
  )

const parserOf = (oxc: Oxc): ParserShape => {
  const jsParse = jsParseOf(oxc)
  const tsParse = scriptAstOf(oxc, 'ts', 'ts')
  const tsxParse = scriptAstOf(oxc, 'tsx', 'tsx')
  const formatOf = getFormat
  function parse<T extends AstFormat>(
    code: string,
    fileName: string,
    formatOverride: T,
  ): Effect.Effect<AstByFormat[T], ParserError>
  function parse(code: string, fileName: string, formatOverride?: AstFormat): Effect.Effect<Ast, ParserError> {
    return Match.value(getFormat(fileName, formatOverride)).pipe(
      Match.when(
        undefined,
        () => Effect.fail(ParserNotFound.make({ fileName, extension: extensionOf(fileName), cause: undefined })),
      ),
      Match.when('js', () => jsParse(code, fileName)),
      Match.when('tsx', () => tsxParse(code, fileName)),
      Match.when('ts', () => tsParse(code, fileName)),
      Match.when('html', () => parseHtml(code, fileName, shape)),
      Match.when('svelte', () => parseSvelte(code, fileName, shape)),
      Match.exhaustive,
    )
  }
  const shape: ParserShape = { parse, formatOf }
  return shape
}

const parserLoadedOnFirstParse = (loadParser: Effect.Effect<ParserShape>): ParserShape => {
  function parse<T extends AstFormat>(
    code: string,
    fileName: string,
    formatOverride: T,
  ): Effect.Effect<AstByFormat[T], ParserError>
  function parse(code: string, fileName: string, formatOverride?: AstFormat): Effect.Effect<Ast, ParserError> {
    return Effect.flatMap(loadParser, (parser) => parser.parse(code, fileName, formatOverride))
  }
  return { parse, formatOf: getFormat }
}

const FORMAT_BY_EXTENSION: Readonly<Record<string, AstFormat>> = {
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.mts': 'ts',
  '.cts': 'ts',
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.vue': 'html',
  '.html': 'html',
  '.htm': 'html',
  '.svelte': 'svelte',
}

const getFormat: {
  (fileName: string, override?: AstFormat): AstFormat | undefined
  (override?: AstFormat): (fileName: string) => AstFormat | undefined
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'string',
  (fileName: string, override?: AstFormat): AstFormat | undefined =>
    override ?? FORMAT_BY_EXTENSION[extensionOf(fileName)],
)

const dotBeforeSlash = (dot: number, slash: number) => dot >= 0 && dot > slash

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf('.')
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  return Boolean.match(dotBeforeSlash(dot, slash), {
    onFalse: () => '',
    onTrue: () => fileName.slice(dot).toLowerCase(),
  })
}

const jsParseOf = (oxc: Oxc) => (text: string, fileName: string) =>
  Effect.map(parseWithOxcOf(oxc)(text, fileName, 'js'), ({ root, comments }) => ({
    originFileName: fileName,
    rawContent: text,
    format: 'js' as const,
    root,
    comments,
  }))

const scriptAstOf = (oxc: Oxc, format: 'ts' | 'tsx', lang: 'ts' | 'tsx') => (text: string, fileName: string) =>
  Effect.map(parseWithOxcOf(oxc)(text, fileName, lang), ({ root, comments }) => ({
    originFileName: fileName,
    rawContent: text,
    format,
    root,
    comments,
  }))

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

const parseHtml = (text: string, originFileName: string, parserContext: ParserShape) =>
  Effect.map(ngHtmlParser(text, originFileName, parserContext), (root) => ({
    originFileName,
    rawContent: text,
    format: 'html' as const,
    root,
  }))

const ngHtmlParser = (text: string, fileName: string, parserContext: ParserShape) =>
  Effect.gen(function*() {
    const ngParser = yield* Effect.promise(() => import('angular-html-parser'))
    const { rootNodes, errors } = ngParser.parse(text, {
      canSelfClose: true,
      allowHtmComponentClosingTags: true,
      isTagNameCaseSensitive: true,
    })
    yield* htmlErrorOf(errors, fileName)
    const scriptEffects: Array<Effect.Effect<ScriptAst, ParserError>> = []
    const scriptCollector: NGAst.Visitor = {
      visitElement: <A = unknown>(el: NGAst.Element, context: A): void => {
        Option.match(Option.fromUndefinedOr(getScriptType(el)), {
          onSome: (scriptFormat) => scriptEffects.push(parseScriptOf(el, scriptFormat)(text, fileName, parserContext)),
          onNone: () => undefined,
        })
        ngParser.visitAll(scriptCollector, el.children, context)
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
    ngParser.visitAll(scriptCollector, rootNodes)
    return { scripts: yield* Effect.all(scriptEffects) }
  })

const htmlErrorOf = (errors: readonly ParseTreeResult['errors'][number][], fileName: string) =>
  Option.match(Arr.head(errors), {
    onSome: (first) =>
      Effect.fail(
        ParseFailed.make({
          fileName,
          message: first.msg,
          location: toSourceLocation(first.span.start),
          cause: first,
        }),
      ),
    onNone: () => Effect.void,
  })

const parseScriptOf = <T extends ScriptFormat>(el: NGAst.Element, scriptFormat: T) =>
(
  text: string,
  fileName: string,
  parserContext: ParserShape,
) =>
  Result.match(elementScriptText(el, text), {
    onSuccess: (scriptText) =>
      Effect.map(
        parserContext.parse(scriptText, fileName, scriptFormat),
        (ast) => {
          const offset = el.startSourceSpan.end
          shiftScriptOffsets(ast, offset.offset)
          return {
            ...ast,
            offset: {
              column: offset.offset,
              line: offset.line,
            },
          }
        },
      ),
    onFailure: Effect.die,
  })

const elementScriptText = (element: NGAst.Element, document: string): Result.Result<string, HtmlEndSpanMissing> =>
  Result.map(
    Result.fromOption(Option.fromNullishOr(element.endSourceSpan), () => HtmlEndSpanMissing.make()),
    (endSourceSpan) => document.substring(element.startSourceSpan.end.offset, endSourceSpan.start.offset),
  )

const toSourceLocation = ({ line, col }: { line: number; col: number }) => ({
  // Offset line with 1, since ngHtmlParser is 0-based
  line: line + 1,
  column: col,
})

const isScriptTag = (element: NGAst.Element) =>
  element.name === 'script' && !element.attrs.some((attr) => attr.name === 'src')

const scriptTypeAttribute = (element: NGAst.Element) =>
  Option.getOrUndefined(
    Option.orElse(
      Arr.findFirst(element.attrs, (attr) => attr.name === 'type'),
      () => Arr.findFirst(element.attrs, (attr) => attr.name === 'lang'),
    ),
  )

const scriptTypeFormat = (element: NGAst.Element): ScriptFormat | undefined =>
  Option.match(Option.fromUndefinedOr(scriptTypeAttribute(element)), {
    onNone: () => 'js',
    onSome: (attribute) => SCRIPT_TYPE_FORMATS[attribute.value.toLowerCase()],
  })

const getScriptType = (element: NGAst.Element): ScriptFormat | undefined =>
  Match.value(element).pipe(
    Match.when(isScriptTag, scriptTypeFormat),
    Match.orElse(() => undefined),
  )

interface TemplateRange extends Range {
  isExpression: boolean
}

interface TemplateScriptRange extends TemplateRange {
  format: 'js' | 'ts'
}

interface ScriptTag {
  content: string
  attributes: Record<string, boolean | string>
}

type WalkFn<A = unknown, R = unknown> = (
  node: A,
  handlers: { enter<B = unknown>(node: B): void },
) => R

interface Version {
  major: number
  minor: number
}

const MINIMUM_SVELTE_VERSION: Version = { major: 3, minor: 30 }
const SVELTE_5: Version = { major: 5, minor: 0 }

const WALKER_MODULE_MISSING = 'walker module without walk export'
const COMPILER_WALK_MISSING = 'svelte/compiler module without walk export'

const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?/

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

const parseVersion = (version: string) =>
  Option.flatMap(
    Option.fromNullishOr(VERSION_PATTERN.exec(version)),
    (match) => Option.fromUndefinedOr(versionFromMatch(match)),
  )

const versionFromMatch = (match: RegExpExecArray) => {
  const major = Number.parseInt(String(match[1]), 10)
  const minor = Number.parseInt(String(match[2]), 10)
  return Boolean.match(Number.isNaN(major) || Number.isNaN(minor), {
    onTrue: () => undefined,
    onFalse: () => ({ major, minor }),
  })
}

const compareVersion = (left: Version, right: Version) =>
  Boolean.match(left.major === right.major, {
    onTrue: () => left.minor - right.minor,
    onFalse: () => left.major - right.major,
  })

const isAtLeast = (version: string, minimum: Version) =>
  Option.match(parseVersion(version), {
    onNone: () => false,
    onSome: (parsed) => compareVersion(parsed, minimum) >= 0,
  })

const isWalkFunction = (value: unknown): value is WalkFn => typeof value === 'function'

const isRecordWithWalk = (value: unknown): value is { walk: WalkFn } =>
  isPlainRecord(value) && isWalkFunction(value['walk'])

const isScriptElement = (value: unknown): value is PlainRecord =>
  isTagged(value, 'Element') && value['name'] === 'script'

const isTextRange = (value: unknown): value is Range => isTagged(value, 'Text') && hasNumericRange(value)

const isTemplateExpressionTag = (value: unknown): value is PlainRecord =>
  isTypedRecord(value) && TEMPLATE_EXPRESSION_TYPES[value['type']] === true

const headOf = <B = unknown, C = unknown>(children: C) =>
  Option.filter(Option.some(children), isNonEmptyArray<B>).pipe(Option.flatMap(Arr.head))

const textRangeOf = <B = unknown>(child: B) =>
  Option.map(Option.filter(Option.some(child), isTextRange), (range) => ({
    start: range.start,
    end: range.end,
    isExpression: false,
  }))

const tryGetScriptRangeFromElement = <A = unknown>(node: A) =>
  Option.flatMap(
    Option.flatMap(Option.filter(Option.some(node), isScriptElement), (element) => headOf(element['children'])),
    textRangeOf,
  )

const templateExpressionRange = <A = unknown>(node: A) =>
  Option.flatMap(
    Option.filter(Option.some(node), isTemplateExpressionTag),
    (tag) => rangedExpressionOf(tag['expression']),
  )

const rangedExpressionOf = <A = unknown>(payload: A) =>
  Option.map(Option.filter(Option.some(payload), isRangedBaseNode), (ranged) => ({
    start: ranged.start,
    end: ranged.end,
    isExpression: true,
  }))

const loadWalker = (version: string, fileName: string): Effect.Effect<WalkFn, SvelteWalkerNotFound> =>
  Boolean.match(isAtLeast(version, SVELTE_5), {
    onTrue: () => loadWalkerModule(import.meta.resolve('oxc-walker'), fileName, WALKER_MODULE_MISSING),
    onFalse: () => loadWalkerModule('svelte/compiler', fileName, COMPILER_WALK_MISSING),
  })

const findWalker = <A = unknown>(module: A) =>
  Option.map(Option.filter(Option.some(module), isRecordWithWalk), (record) => record.walk)

const loadWalkerModule = (specifier: string, fileName: string, cause: string) =>
  Effect.flatMap(Effect.promise<PlainRecord>(() => import(specifier)), (module) =>
    Option.match(findWalker(module), {
      onNone: () => Effect.fail<SvelteWalkerNotFound>(SvelteWalkerNotFound.make({ fileName, cause })),
      onSome: (walk) => Effect.succeed<WalkFn>(walk),
    }))

const parseSvelte = (text: string, fileName: string, parserContext: ParserShape) =>
  Effect.gen(function*() {
    const { parse: svelteParse, preprocess, VERSION } = yield* Effect.promise(() => import('svelte/compiler'))

    yield* supportedVersionOf(VERSION, fileName)
    const walk = yield* loadWalker(VERSION, fileName)

    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(text))
    const { replacedCode, scriptMap } = yield* replaceScripts(text, preprocess)
    const svelteAst = svelteParse(replacedCode, { filename: fileName })

    const moduleScriptRange = yield* Result.match(getModuleScriptRange(svelteAst), {
      onSuccess: Effect.succeed,
      onFailure: Effect.die,
    })
    const templateRanges = yield* Result.match(templateScriptRangesOf(svelteAst, walk), {
      onSuccess: Effect.succeed,
      onFailure: Effect.die,
    })
    const { remappedModuleScriptRange, remappedScriptRanges } = remapScriptLocations(
      replacedCode,
      scriptMap,
      moduleScriptRange,
      templateRanges,
    )

    const moduleScript = yield* parseTemplateScriptIfDefined(
      remappedModuleScriptRange,
      parserContext,
      text,
      fileName,
      lineTable,
    )
    const additionalScripts = yield* Effect.forEach(
      remappedScriptRanges,
      (range) => parseTemplateScript(range, parserContext, text, fileName, lineTable),
    )

    return {
      originFileName: fileName,
      rawContent: text,
      format: 'svelte' as const,
      root: svelteRoot(moduleScript, additionalScripts),
    }
  })

const supportedVersionOf = (version: string, fileName: string) =>
  Boolean.match(isAtLeast(version, MINIMUM_SVELTE_VERSION), {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.fail(
        SvelteVersionNotSupported.make({
          version,
          fileName,
          cause: `Expected >=3.30`,
        }),
      ),
  })

const replaceScripts = (
  code: string,
  preprocess: (code: string, handlers: { script(script: ScriptTag): { code: string } }) => Promise<{ code: string }>,
) => {
  const map = new Map<string, ScriptTag>()
  return Effect.map(
    Effect.promise(() =>
      preprocess(code, {
        script(script: ScriptTag) {
          const scriptName = `script${map.size}`
          map.set(scriptName, script)
          return { code: scriptName }
        },
      })
    ),
    (result) => ({ replacedCode: result.code, scriptMap: map }),
  )
}

const parseTemplateScriptIfDefined = (
  range: TemplateScriptRange | undefined,
  parserContext: ParserShape,
  text: string,
  fileName: string,
  lineTable: LineTable,
): Effect.Effect<Option.Option<TemplateScript>, ParserError> =>
  Option.match(Option.fromUndefinedOr(range), {
    onNone: () => Effect.succeedNone,
    onSome: (scriptRange) => Effect.asSome(parseTemplateScript(scriptRange, parserContext, text, fileName, lineTable)),
  })

const parseTemplateScript = (
  { start, end, isExpression, format }: TemplateScriptRange,
  parserContext: ParserShape,
  text: string,
  fileName: string,
  lineTable: LineTable,
) =>
  Effect.map(
    parserContext.parse(text.slice(start, end), fileName, format),
    (parsed): TemplateScript => ({
      ast: {
        ...parsed,
        offset: lineTable.zeroBasedPositionAt(start),
      },
      range: { start, end },
      isExpression,
    }),
  )

const svelteRoot = (moduleScript: Option.Option<TemplateScript>, additionalScripts: Array<TemplateScript>) =>
  Option.match(moduleScript, {
    onNone: () => ({ additionalScripts }),
    onSome: (script) => ({ moduleScript: script, additionalScripts }),
  })

const templateScriptRangesOf = <A = unknown>(
  ast: A,
  walker: WalkFn,
): Result.Result<Array<TemplateRange>, SvelteHtmlMissing | SvelteRangeMissing> =>
  Result.flatMap(htmlRootOf(ast), (root) =>
    Result.map(instanceScriptRange(ast), (instance) => {
      const visited: Array<TemplateRange> = []
      walker(root, {
        enter: (node) => {
          Option.toArray(tryGetScriptRangeFromElement(node)).forEach((range) => visited.push(range))
          Option.toArray(templateExpressionRange(node)).forEach((range) => visited.push(range))
        },
      })
      return Arr.appendAll(Option.toArray(instance), visited)
    }))

const htmlRootOf = <A = unknown, B = unknown>(ast: A): Result.Result<B, SvelteHtmlMissing> =>
  Result.map(
    Result.fromOption(Option.filter(Option.some(ast), hasHtmlField<B>), () => SvelteHtmlMissing.make()),
    (withHtml) => withHtml.html,
  )

const instanceScriptRange = <A = unknown>(ast: A): Result.Result<Option.Option<TemplateRange>, SvelteRangeMissing> =>
  Option.match(Option.fromUndefinedOr(contentFieldOf(fieldOf(ast, 'instance'))), {
    onNone: () => Result.succeed(Option.none()),
    onSome: (record) => Result.map(rangeOf(record['content'], 'instance'), Option.some),
  })

const rangeOf = <A = unknown>(
  content: A,
  script: 'instance' | 'module',
): Result.Result<TemplateRange, SvelteRangeMissing> =>
  Result.fromOption(
    Option.map(
      Option.filter(Option.some(content), isRange),
      (range) => ({ start: range.start, end: range.end, isExpression: false }),
    ),
    () => SvelteRangeMissing.make({ script }),
  )

const getModuleScriptRange = <A = unknown>(
  svelteAst: A,
): Result.Result<Option.Option<TemplateRange>, SvelteRangeMissing> =>
  Match.value(fieldOf(svelteAst, 'module')).pipe(
    Match.when(undefined, () => Result.succeed(Option.none())),
    Match.when(null, () => Result.succeed(Option.none())),
    Match.orElse((block) => Result.map(moduleBlockRange(block), Option.some)),
  )

const contentFieldOf = <A = unknown>(value: A | undefined) =>
  Option.getOrUndefined(Option.filter(Option.fromNullishOr(value), hasContentField<A>))

const moduleBlockRange = <A = unknown>(block: A): Result.Result<TemplateRange, SvelteRangeMissing> =>
  Result.flatMap(
    Result.fromOption(Option.fromNullishOr(contentFieldOf(block)), () => SvelteRangeMissing.make({ script: 'module' })),
    (record) => rangeOf(record['content'], 'module'),
  )

interface RemappedScript {
  readonly range: TemplateRange
  readonly scriptRange: TemplateScriptRange
  readonly hadScript: boolean
}

interface RangeRemap {
  readonly placeholderLength: number
  readonly contentLength: number
  readonly format: 'js' | 'ts'
  readonly hadScript: boolean
}

const remapScriptLocations = (
  code: string,
  scriptMap: Map<string, ScriptTag>,
  moduleScriptRange: Option.Option<TemplateRange>,
  templateRanges: Array<TemplateRange>,
) => {
  const ordered = Arr.appendAll(Option.toArray(moduleScriptRange), templateRanges).sort((left, right) =>
    left.start - right.start
  )
  const remapped = remapInOrder(ordered, code, scriptMap)
  const remappedModuleScriptRange = Option.getOrUndefined(
    Option.map(
      Arr.findFirst(
        remapped,
        (script) => Option.exists(moduleScriptRange, (range) => script.range === range && script.hadScript),
      ),
      (script) => script.scriptRange,
    ),
  )
  return {
    remappedModuleScriptRange,
    remappedScriptRanges: remapped
      .map((script) => script.scriptRange)
      .filter((range) => range !== remappedModuleScriptRange),
  }
}

const remapInOrder = (
  ranges: readonly TemplateRange[],
  code: string,
  scriptMap: Map<string, ScriptTag>,
): Array<RemappedScript> =>
  Arr.mapAccum(ranges, 0, (offset, range) => {
    const remap = remapRange(range, code, scriptMap)
    const start = range.start + offset
    return [
      offset + remap.contentLength - remap.placeholderLength,
      {
        range,
        scriptRange: {
          start,
          end: start + remap.contentLength,
          isExpression: range.isExpression,
          format: remap.format,
        },
        hadScript: remap.hadScript,
      },
    ] as const
  })[1]

const remapRange = (range: TemplateRange, code: string, scriptMap: Map<string, ScriptTag>): RangeRemap => {
  const placeholder = code.substring(range.start, range.end)
  return Match.value(scriptMap.get(placeholder)).pipe(
    Match.when(undefined, (): RangeRemap => ({
      placeholderLength: placeholder.length,
      contentLength: placeholder.length,
      format: 'js',
      hadScript: false,
    })),
    Match.orElse((script): RangeRemap => ({
      placeholderLength: placeholder.length,
      contentLength: script.content.length,
      format: scriptFormatOf(script),
      hadScript: true,
    })),
  )
}

const scriptFormatOf = (script: ScriptTag) =>
  Boolean.match(script.attributes['lang'] === 'ts', {
    onTrue: () => 'ts' as const,
    onFalse: () => 'js' as const,
  })
