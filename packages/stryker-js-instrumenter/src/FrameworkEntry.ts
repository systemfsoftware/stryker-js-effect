import type {
  EmbeddedDocument,
  Framework,
  FrameworkContext,
  FrameworkParseResult,
  ScriptFormat,
} from '@systemfsoftware/stryker-framework-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { type Program, type Statement } from './Ast.handle.js'
import { type Ast, type EmbeddedAst, type EmbeddedScript, type ScriptAst } from './Ast.schema.js'
import { makeScriptParser } from './drivers/oxc-program.js'
import { ErrorText } from './ErrorText.schema.js'
import type { EmbeddedFormatEntry, FormatClaim } from './Format.schema.js'
import { InstrumentError } from './Instrument.schema.js'
import { instrumentationHeader } from './InstrumentHeader.js'
import { type LineTable, LineTableFromText, type Position } from './Location.schema.js'
import { ParseFailed } from './Parser.schema.js'
import { loadOxc } from './Parser.service.js'
import { printProgram } from './print/SourceText.js'

const toOneBasedOrigin = (origin: Position): Position => ({ line: origin.line + 1, column: origin.column })

interface FrameworkToolkit {
  readonly parseScript: (source: string, scriptFormat: ScriptFormat) => Program
  readonly header: readonly Statement[]
}

const loadFrameworkToolkit: Effect.Effect<FrameworkToolkit, ParseFailed> = Effect.gen(function*() {
  const oxc = yield* loadOxc
  const header = yield* instrumentationHeader
  return {
    parseScript: makeScriptParser(oxc),
    header,
  }
})

const frameworkContextOf = (toolkit: FrameworkToolkit): FrameworkContext => ({
  parseScript: toolkit.parseScript,
  printScript: (script) => printProgram(script, { hashbang: null }),
  instrumentationHeader: () => toolkit.header,
})

const embeddedScriptsOf = (
  document: EmbeddedDocument,
  rawContent: string,
  originFileName: string,
  lineTable: LineTable,
): readonly EmbeddedScript[] =>
  document.regions.flatMap((region, index) => {
    const ast: ScriptAst = {
      format: 'js',
      root: region.scriptAst,
      comments: [],
      rawContent: rawContent.slice(region.start, region.end),
      originFileName,
      offset: toOneBasedOrigin(lineTable.zeroBasedPositionAt(region.start)),
    }
    return [{ region: index, ast }]
  })

const embeddedAstError = (ast: Ast): InstrumentError =>
  InstrumentError.make({
    message: `Expected an embedded document AST, received the "${ast.format}" format`,
    cause: undefined,
  })

const embeddedOf = (ast: Ast): Option.Option<EmbeddedAst> =>
  Match.value(ast).pipe(
    Match.when({ format: 'embedded' }, (embedded) => Option.some(embedded)),
    Match.orElse(() => Option.none<EmbeddedAst>()),
  )

const printNothingForNonEmbeddedAst = (): string => ''

const frameworkFailure = (moduleName: string, fileName: string, detail: string): InstrumentError =>
  InstrumentError.make({
    message: `The framework "${moduleName}" could not parse ${fileName}: ${detail}`,
    cause: new Error(detail),
  })

const hookFailure = <A = unknown>(moduleName: string, hook: string, fileName: string, cause: A): InstrumentError =>
  InstrumentError.make({
    message: `The framework "${moduleName}" threw while running ${hook} for ${fileName}: ${errorTextOf(cause)}`,
    cause,
  })

const errorTextOf = <A = unknown>(cause: A): string =>
  Option.getOrElse(Option.map(ErrorText.fromCause(cause), (text: ErrorText) => text.text), () => '')

const runHook = <A>(
  moduleName: string,
  hook: string,
  fileName: string,
  run: () => A,
): Effect.Effect<A, InstrumentError> =>
  Effect.try({ try: run, catch: (cause) => hookFailure(moduleName, hook, fileName, cause) })

const settled = <A>(
  moduleName: string,
  fileName: string,
  result: FrameworkParseResult<A>,
): Effect.Effect<A, InstrumentError> =>
  result.kind === 'Parsed'
    ? Effect.succeed(result.value)
    : Effect.fail(frameworkFailure(moduleName, fileName, result.message))

const frameworkEntryOfDataFirst = (moduleName: string, framework: Framework): EmbeddedFormatEntry => ({
  claim: {
    formatId: framework.claim.formatId,
    extensions: [...framework.claim.extensions],
    language: framework.claim.language,
    kind: 'embedded',
  } satisfies FormatClaim<'embedded'>,
  owner: moduleName,
  ownerVersion: framework.claim.ownerVersion,
  parse: Effect.fn('stryker.instrument.framework_entry.parse')(function*(text: string, fileName: string) {
    const context = frameworkContextOf(yield* loadFrameworkToolkit)
    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(text))
    const result = yield* runHook(moduleName, 'parse', fileName, () => framework.parse(text, context))
    const document = yield* settled(moduleName, fileName, result)
    return {
      format: 'embedded',
      formatId: framework.claim.formatId,
      originFileName: fileName,
      rawContent: text,
      document,
      context,
      scripts: embeddedScriptsOf(document, text, fileName, lineTable),
    } satisfies EmbeddedAst
  }),
  transform: (ast, mutantCollector, context) =>
    Option.match(embeddedOf(ast), {
      onNone: () => Effect.fail(embeddedAstError(ast)),
      onSome: Effect.fn('stryker.instrument.framework_entry.transform')(function*(embedded: EmbeddedAst) {
        const warnings = yield* Effect.forEach(
          embedded.scripts,
          (script) => context.transform(script.ast, mutantCollector, context),
        )
        embedded.document = yield* runHook(
          moduleName,
          'transform',
          embedded.originFileName,
          () => framework.transform(embedded.document, embedded.context),
        )
        return warnings.flat()
      }),
    }),
  print: (ast) =>
    Option.match(embeddedOf(ast), {
      onNone: printNothingForNonEmbeddedAst,
      onSome: (embedded) => framework.print(embedded.document, embedded.context),
    }),
  disableTypeChecks: (ast) =>
    Option.match(embeddedOf(ast), {
      onNone: () => Effect.fail(embeddedAstError(ast)),
      onSome: (embedded) =>
        runHook(
          moduleName,
          'disableTypeChecks',
          embedded.originFileName,
          () => framework.disableTypeChecks(embedded.rawContent),
        ).pipe(Effect.flatMap((result) => settled(moduleName, embedded.originFileName, result))),
    }),
})

export const frameworkEntryOf: {
  (moduleName: string, framework: Framework): EmbeddedFormatEntry
  (framework: Framework): (moduleName: string) => EmbeddedFormatEntry
} = dual((args: IArguments): boolean => args.length >= 2, frameworkEntryOfDataFirst)
