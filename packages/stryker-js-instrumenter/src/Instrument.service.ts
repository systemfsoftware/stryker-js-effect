import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import { spanOf, type Node } from './Ast.js'
import {
  FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  InstrumentResult as InstrumentResultSchema,
} from './Instrument.schema.js'
import type { FileDescription, MutateDescription } from './Mutant.js'
import { Mutant as ApiMutant } from './Mutant.schema.js'
import { toApiMutant } from './Mutator.js'
import { Parser, type ParserError, type ParserShape } from './Parser.service.js'
import { print } from './Printer.js'
import { type Ast, AstFormat, type HtmlAst, type ScriptAst, type SvelteAst, type SpannedComment } from './Syntax.js'
import { type MutantCollector, Transformer, type TransformerOptions, type TransformerShape } from './Transformer.service.js'

export interface File extends FileDescription {
  name: string
  content: string
}
export interface InstrumentResult {
  files: readonly File[]
  mutants: readonly ApiMutant[]
}

export type { InstrumenterOptions }

const commentDirectiveRegEx = /^(\s*)@(ts-[a-z-]+).*$/
const tsDirectiveLikeRegEx = /@(ts-[a-z-]+)/
const STARTING_COMMENT = /^\s*\/\*[\s\S]*?\*\//

export interface InstrumentShape {
  readonly disableTypeChecks: (file: File) => Effect.Effect<File, InstrumentError>
  readonly instrument: {
    (
      files: readonly File[],
      options: InstrumenterOptions,
      basePath?: string,
    ): Effect.Effect<InstrumentResult, InstrumentError>
    (
      options: InstrumenterOptions,
      basePath?: string,
    ): (files: readonly File[]) => Effect.Effect<InstrumentResult, InstrumentError>
  }
}

export class Instrument
  extends Context.Service<Instrument, InstrumentShape>()(
    '@systemfsoftware/stryker-js-instrumenter/Instrument.service/Instrument',
  ) {
  static readonly layer: Layer.Layer<Instrument, ParserError, Parser | Transformer> = Layer.effect(
    Instrument,
    Effect.gen(function*() {
      const parser = yield* Parser
      const transformer = yield* Transformer
      return Instrument.of({
        disableTypeChecks: (file) => disableTypeChecksWith(parser, file),
        instrument: instrumentDual(parser, transformer),
      })
    }),
  )
}

const instrumentDual: (
  parser: ParserShape,
  transformer: TransformerShape,
) => InstrumentShape['instrument'] = (parser, transformer) =>
  dual(
    (args: IArguments): boolean => args.length >= 2,
    (files: readonly File[], options: InstrumenterOptions, basePath?: string) =>
      instrumentWith(files, options, basePath, parser, transformer),
  )

const disableTypeChecksWith = (
  parser: ParserShape,
  file: File,
): Effect.Effect<File, InstrumentError> =>
  Option.match(Option.fromUndefinedOr(parser.formatOf(file.name)), {
    onNone: () => Effect.succeed(file),
    onSome: (format) => disableTypeChecksFor(parser, file, format),
  })

const baseLayers: Layer.Layer<Parser | Transformer, ParserError> = Transformer.layer.pipe(
  Layer.provideMerge(Parser.layer),
)

const instrumenterLayers: Layer.Layer<Parser | Transformer | Instrument, ParserError> = Instrument.layer.pipe(
  Layer.provideMerge(baseLayers),
)

export const disableTypeChecks = (file: File): Effect.Effect<File, InstrumentError> =>
  Effect.scoped(
    instrumenterLayers.pipe(
      Layer.build,
      Effect.mapError((cause) =>
        InstrumentError.make({ message: `Failed to load instrumenter for ${file.name}`, cause })
      ),
      Effect.flatMap((context) =>
        Effect.provide(
          Effect.flatMap(Instrument, (instrument) => instrument.disableTypeChecks(file)),
          context,
        )),
    ),
  )

const disableTypeChecksFor = (parser: ParserShape, file: File, format: AstFormat) =>
  Boolean.match(isJSFileWithoutTSDirectives(file, format), {
    onTrue: () => Effect.succeed({ ...file, content: prefixWithNoCheck(file.content) }),
    onFalse: () =>
      Effect.map(
        parser.parse(file.content, file.name).pipe(
          Effect.mapError((cause) => InstrumentError.make({ message: `Failed to parse ${file.name}`, cause })),
        ),
        (ast) => withDisabledTypeChecking(file, ast),
      ),
  })

const withDisabledTypeChecking = (file: File, ast: Ast): File =>
  Match.value(ast).pipe(
    Match.when({ format: 'js' }, (script) => ({ ...file, content: disableTypeCheckingInScript(script) })),
    Match.when({ format: 'ts' }, (script) => ({ ...file, content: disableTypeCheckingInScript(script) })),
    Match.when({ format: 'tsx' }, (script) => ({ ...file, content: disableTypeCheckingInScript(script) })),
    Match.when({ format: 'html' }, (html) => ({ ...file, content: disableTypeCheckingInHtml(html) })),
    Match.when({ format: 'svelte' }, (svelte) => ({ ...file, content: disableTypeCheckingInSvelte(svelte) })),
    Match.exhaustive,
  )

const JS_OR_TS_FORMATS: ReadonlySet<AstFormat> = new Set(['js', 'ts'])

const isJSFileWithoutTSDirectives = (file: File, format: AstFormat): boolean =>
  JS_OR_TS_FORMATS.has(format) && !tsDirectiveLikeRegEx.test(file.content)

const disableTypeCheckingInScript = (ast: ScriptAst): string =>
  prefixWithNoCheck(removeTSDirectives(ast.rawContent, ast.comments))

const prefixWithNoCheck = (code: string) =>
  Boolean.match(code.startsWith('#'), {
    onTrue: () => afterHashbang(code),
    onFalse: () => afterLeadingComment(code),
  })

const afterHashbang = (code: string) => {
  const newLineIndex = code.indexOf('\n')
  return Boolean.match(newLineIndex <= 0, {
    onTrue: () => code,
    onFalse: () => `${code.substring(0, newLineIndex)}\n// @ts-nocheck\n${code.substring(newLineIndex + 1)}`,
  })
}

const afterLeadingComment = (code: string) =>
  Option.match(leadingCommentOf(code), {
    onNone: () => `// @ts-nocheck\n${code}`,
    onSome: (leadingComment) =>
      `${leadingComment.concat('\n')}// @ts-nocheck\n${code.substring(leadingComment.length)}`,
  })

const leadingCommentOf = (code: string) => Option.fromNullishOr(STARTING_COMMENT.exec(code)?.[0])

const requiredSpanOf = (root: Node, missing: string) =>
  Option.getOrThrowWith(Option.fromUndefinedOr(spanOf(root)), () => new Error(missing))

const getScriptStart = (script: HtmlAst['root']['scripts'][number]): number =>
  requiredSpanOf(script.root, 'Script AST root without start').start

const getScriptEnd = (script: HtmlAst['root']['scripts'][number]): number =>
  requiredSpanOf(script.root, 'Script AST root without end').end

interface WrittenText {
  readonly text: string
  readonly cursor: number
}

const disableTypeCheckingInHtml = (ast: HtmlAst): string => {
  const sortedScripts = [...ast.root.scripts].sort((a, b) => getScriptStart(a) - getScriptStart(b))
  const written = Arr.reduce(sortedScripts, { text: '', cursor: 0 }, (state, script) => ({
    text: `${state.text}${ast.rawContent.substring(state.cursor, getScriptStart(script))}\n${
      prefixWithNoCheck(removeTSDirectives(script.rawContent, script.comments))
    }\n`,
    cursor: getScriptEnd(script),
  }))
  return written.text + ast.rawContent.substring(written.cursor)
}

const disableTypeCheckingInSvelte = (ast: SvelteAst): string => {
  const sortedScripts = [ast.root.moduleScript, ...ast.root.additionalScripts]
    .filter(Predicate.isNotNullish)
    .sort((a, b) => a.range.start - b.range.start)
  const written = Arr.reduce(sortedScripts, { text: '', cursor: 0 } satisfies WrittenText, (state, script) => ({
    text: `${state.text}${ast.rawContent.substring(state.cursor, script.range.start)}\n${
      prefixWithNoCheck(removeTSDirectives(script.ast.rawContent, script.ast.comments))
    }\n`,
    cursor: script.range.end,
  }))
  return written.text + ast.rawContent.substring(written.cursor)
}

interface DirectiveRange {
  readonly startPos: number
  readonly endPos: number
}

const removeTSDirectives = (text: string, comments: readonly SpannedComment[] | null | undefined): string =>
  removeRanges(text, directiveRanges(comments))

const directiveRanges = (comments: readonly SpannedComment[] | null | undefined): readonly DirectiveRange[] =>
  (comments ?? [])
    .flatMap((comment) => Option.toArray(tryParseTSDirective(comment)))
    .sort((a, b) => a.startPos - b.startPos)

const removeRanges = (text: string, ranges: readonly DirectiveRange[]): string => {
  const remaining = ranges.reduce(
    (state, range) => ({
      pruned: state.pruned + text.substring(state.cursor, range.startPos),
      cursor: range.endPos,
    }),
    { pruned: '', cursor: 0 },
  )
  return remaining.pruned + text.substring(remaining.cursor)
}

const tryParseTSDirective = (comment: SpannedComment) =>
  Option.map(Option.fromNullishOr(commentDirectiveRegEx.exec(comment.value)), (match) => {
    const directivePrefix = requirePart(match[1], 'TS directive match without prefix')
    const directiveName = requirePart(match[2], 'TS directive match without directive name')
    const startPos = comment.start + directivePrefix.length + 2
    return { startPos, endPos: startPos + directiveName.length + 1 }
  })

const requirePart = (part: string | undefined, message: string) =>
  Option.getOrThrowWith(Option.fromUndefinedOr(part), () => new Error(message))

const toOneBasedLineNumber = (range: MutateDescription): MutateDescription =>
  Match.value(range).pipe(
    Match.when(Match.boolean, (value) => value),
    Match.orElse((locations) =>
      locations.map(({ start, end }) => ({
        start: { column: start.column, line: start.line + 1 },
        end: { column: end.column, line: end.line + 1 },
      }))),
  )

const isIgnorer = (value: unknown): value is Ignorer =>
  Predicate.isObject(value) && typeof value['shouldIgnore'] === 'function'

const toTransformerOptions = (options: InstrumenterOptions): TransformerOptions => ({
  excludedMutations: [...options.excludedMutations],
  ignorers: options.ignorers.filter(isIgnorer),
  ...Option.match(Option.fromUndefinedOr(options.noHeader), {
    onNone: () => ({}),
    onSome: (noHeader) => ({ noHeader }),
  }),
})

const AST_SHAPE = ['format', 'root'] as const

const isAst = (value: unknown): value is Ast =>
  Predicate.isObject(value) && AST_SHAPE.every((key) => key in value)

type FileSchemaType = typeof FileSchema.Type

const printedFile = (file: FileSchemaType, ast: Ast): readonly FileSchemaType[] =>
  Option.match(Option.filter(Option.some(ast), isAst), {
    onNone: () => [],
    onSome: (parsed) => [{ name: file.name, mutate: file.mutate, content: print(parsed) }],
  })


const instrumentWith = (
  files: readonly File[],
  options: InstrumenterOptions,
  basePath: string | undefined,
  parser: ParserShape,
  transformer: TransformerShape,
) =>
  Effect.gen(function*() {
    const schemaFiles = files.map((file) => ({ name: file.name, content: file.content, mutate: file.mutate }))
    const parsed = yield* Effect.forEach(schemaFiles, (file) =>
      Effect.map(
        parser.parse(file.content, file.name).pipe(
          Effect.mapError((cause) => InstrumentError.make({ message: `Failed to parse ${file.name}`, cause })),
        ),
        (ast) => ({ file, ast }),
      ))
    const collector: MutantCollector = []
    yield* Effect.forEach(parsed, ({ file, ast }) =>
      transformer.transform(ast, collector, {
        options: toTransformerOptions(options),
        mutateDescription: toOneBasedLineNumber(file.mutate),
        basePath,
      }).pipe(
        Effect.mapError((cause) => InstrumentError.make({ message: `Failed to transform ${file.name}`, cause })),
      ))
    const mutants = yield* Effect.try({
      try: () => collector.map(toApiMutant),
      catch: (cause) => InstrumentError.make({ message: 'Failed to instrument', cause }),
    })
    const printed = yield* Effect.try({
      try: () => parsed.flatMap(({ file, ast }) => printedFile(file, ast)),
      catch: (cause) => InstrumentError.make({ message: 'Failed to print', cause }),
    })
    return InstrumentResultSchema.make({ files: printed, mutants })
  })

export const instrument: {
  (
    files: readonly File[],
    options: InstrumenterOptions,
    basePath?: string,
  ): Effect.Effect<InstrumentResult, InstrumentError>
  (
    options: InstrumenterOptions,
    basePath?: string,
  ): (files: readonly File[]) => Effect.Effect<InstrumentResult, InstrumentError>
} = dual(
  2,
  (files: readonly File[], options: InstrumenterOptions, basePath?: string) =>
    Effect.scoped(
      instrumenterLayers.pipe(
        Layer.build,
        Effect.mapError((cause) => InstrumentError.make({ message: 'Failed to load instrumenter', cause })),
        Effect.flatMap((context) =>
          Effect.provide(
            Effect.flatMap(Instrument, (instrument) => instrument.instrument(files, options, basePath)),
            context,
          )),
      ),
    ),
)
