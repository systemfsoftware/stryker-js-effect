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
import * as Result from 'effect/Result'
import { spanOf } from './Ast.handle.js'
import type { Ast, HtmlAst, ScriptAst, SvelteAst, SpannedComment } from './Ast.schema.js'
import {
  type FileDescription,
  FileSchema,
  type InstrumenterOptions,
  InstrumentError,
  InstrumentResult as InstrumentResultSchema,
  type MutateDescription,
  ScriptRootWithoutSpan,
} from './Instrument.schema.js'
import { Mutant as ApiMutant } from './Mutant.schema.js'
import { Mutators, type MutatorsShape } from './Mutator.service.js'
import { Parser, type ParserError, type ParserShape } from './Parser.service.js'
import { PrintFailed } from './print/PrintFailed.schema.js'
import { SourceText } from './print/SourceText.schema.js'
import { AstFormat } from './Syntax.schema.js'
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
  static readonly layer: Layer.Layer<Instrument, ParserError, Parser | Transformer | Mutators> = Layer.effect(
    Instrument,
    Effect.gen(function*() {
      const parser = yield* Parser
      const transformer = yield* Transformer
      const mutators = yield* Mutators
      return Instrument.of({
        disableTypeChecks: (file) => disableTypeChecksWith(parser, file),
        instrument: instrumentDual(parser, transformer, mutators),
      })
    }),
  )
}

const instrumentDual: (
  parser: ParserShape,
  transformer: TransformerShape,
  mutators: MutatorsShape,
) => InstrumentShape['instrument'] = (parser, transformer, mutators) =>
  dual(
    (args: IArguments): boolean => args.length >= 2,
    (files: readonly File[], options: InstrumenterOptions, basePath?: string) =>
      instrumentWith(files, options, basePath, parser, transformer, mutators),
  )

const disableTypeChecksWith = (
  parser: ParserShape,
  file: File,
): Effect.Effect<File, InstrumentError> =>
  Option.match(Option.fromUndefinedOr(parser.formatOf(file.name)), {
    onNone: () => Effect.succeed(file),
    onSome: (format) => disableTypeChecksFor(parser, file, format),
  })

const baseLayers: Layer.Layer<Parser | Transformer | Mutators, ParserError> = Transformer.layer.pipe(
  Layer.provideMerge(Parser.layer),
  Layer.provideMerge(Mutators.layer),
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
      Effect.flatMap(
        parser.parse(file.content, file.name).pipe(
          Effect.mapError((cause) => InstrumentError.make({ message: `Failed to parse ${file.name}`, cause })),
        ),
        (ast) => withDisabledTypeChecking(file, ast),
      ),
  })

const withDisabledTypeChecking = (file: File, ast: Ast): Effect.Effect<File> =>
  Match.value(ast).pipe(
    Match.when({ format: 'js' }, (script) => Effect.succeed({ ...file, content: disableTypeCheckingInScript(script) })),
    Match.when({ format: 'ts' }, (script) => Effect.succeed({ ...file, content: disableTypeCheckingInScript(script) })),
    Match.when({ format: 'tsx' }, (script) => Effect.succeed({ ...file, content: disableTypeCheckingInScript(script) })),
    Match.when({ format: 'html' }, (html) =>
      Effect.map(disableTypeCheckingInHtml(html), (content) => ({ ...file, content }))),
    Match.when({ format: 'svelte' }, (svelte) =>
      Effect.map(disableTypeCheckingInSvelte(svelte), (content) => ({ ...file, content }))),
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

interface PositionedScript<A> {
  readonly script: A
  readonly start: number
  readonly end: number
}

const htmlScriptPositionOf = (
  script: HtmlAst['root']['scripts'][number],
): Result.Result<PositionedScript<HtmlAst['root']['scripts'][number]>, ScriptRootWithoutSpan> =>
  Option.match(Option.fromNullishOr(spanOf(script.root)), {
    onNone: () => Result.fail(ScriptRootWithoutSpan.make({ edge: 'start' })),
    onSome: (span) => Result.succeed({ script, start: span.start, end: span.end }),
  })

const disableTypeCheckingInHtml = (ast: HtmlAst): Effect.Effect<string> =>
  Result.match(Result.all(Arr.map(ast.root.scripts, htmlScriptPositionOf)), {
    onSuccess: (positioned) =>
      Effect.succeed(
        writeAround(
          ast.rawContent,
          [...positioned].sort((left, right) => left.start - right.start),
          (script) => prefixWithNoCheck(removeTSDirectives(script.rawContent, script.comments)),
        ),
      ),
    onFailure: (failure) => Effect.die(failure),
  })

const svelteScriptPositionOf = (script: TemplateSvelteScript): PositionedScript<TemplateSvelteScript> => ({
  script,
  start: script.range.start,
  end: script.range.end,
})

const disableTypeCheckingInSvelte = (ast: SvelteAst): Effect.Effect<string> => {
  const positioned = [ast.root.moduleScript, ...ast.root.additionalScripts]
    .filter(Predicate.isNotNullish)
    .map(svelteScriptPositionOf)
  return Effect.succeed(
    writeAround(
      ast.rawContent,
      [...positioned].sort((left, right) => left.start - right.start),
      (script) => prefixWithNoCheck(removeTSDirectives(script.ast.rawContent, script.ast.comments)),
    ),
  )
}

type TemplateSvelteScript = NonNullable<SvelteAst['root']['moduleScript']>

const writeAround = <A>(
  rawContent: string,
  positioned: ReadonlyArray<PositionedScript<A>>,
  replacementOf: (script: A) => string,
): string => {
  const written = Arr.reduce(positioned, { text: '', cursor: 0 }, (state, entry) => ({
    text: `${state.text}${rawContent.substring(state.cursor, entry.start)}\n${replacementOf(entry.script)}\n`,
    cursor: entry.end,
  }))
  return written.text + rawContent.substring(written.cursor)
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
  Option.flatMap(Option.fromNullishOr(commentDirectiveRegEx.exec(comment.value)), (match) =>
    Option.flatMap(Option.fromNullishOr(match[1]), (directivePrefix) =>
      Option.map(Option.fromNullishOr(match[2]), (directiveName) => {
        const startPos = comment.start + directivePrefix.length + 2
        return { startPos, endPos: startPos + directiveName.length + 1 }
      })))

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

const printedFile = (file: FileSchemaType, ast: Ast): Result.Result<readonly FileSchemaType[], PrintFailed> =>
  Option.match(Option.filter(Option.some(ast), isAst), {
    onNone: () => Result.succeed([]),
    onSome: (parsed) =>
      Option.match(SourceText.fromValue(parsed), {
        onNone: () => Result.fail(PrintFailed.make({ message: 'Script AST root without start' })),
        onSome: (rendered) => Result.succeed([{ name: file.name, mutate: file.mutate, content: rendered.text }]),
      }),
  })


const instrumentWith = (
  files: readonly File[],
  options: InstrumenterOptions,
  basePath: string | undefined,
  parser: ParserShape,
  transformer: TransformerShape,
  mutators: MutatorsShape,
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
    const mutants = yield* Result.match(Result.all(Arr.map(collector, mutators.toApi)), {
      onSuccess: Effect.succeed,
      onFailure: (failure) => Effect.fail(InstrumentError.make({ message: 'Failed to instrument', cause: failure })),
    })
    const printed = yield* Result.match(Result.all(Arr.map(parsed, ({ file, ast }) => printedFile(file, ast))), {
      onSuccess: (files) => Effect.succeed(files.flat()),
      onFailure: (failure) => Effect.fail(InstrumentError.make({ message: 'Failed to print', cause: failure })),
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
