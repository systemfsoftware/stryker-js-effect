import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type Ast, type ScriptAst, type ScriptFormat } from './Ast.schema.js'
import {
  type EmbeddedFormatEntry,
  type EntryForFormat,
  type FormatClaim,
  type FormatEntry,
  type FormatRegistry,
  type ScriptFormatEntry,
} from './Format.schema.js'
import { FileSchema, type InstrumenterOptions, InstrumentError, InstrumentFileSkip } from './Instrument.schema.js'
import type { Mutant as ApiMutant } from './Mutant.schema.js'
import { toApiMutant } from './Mutator.service.js'
import type { ParseFailed } from './Parser.schema.js'
import { createParser, parseJS, parseTS, parseTsx } from './Parser.service.js'
import { jsPrint, type PrinterContext, tsPrint } from './Printer.js'
import {
  FormatAssigned,
  FormatResolutionCommand,
  type FormatResolutionDecision,
  FormatSkipped,
  resolveFormat,
} from './resolve-format.workflow.js'
import { type MutantCollector, transform, type TransformerOptions, transformScript } from './Transformer.service.js'
import { disableTypeCheckingInScript, prefixWithNoCheck, tsDirectiveLikeRegEx } from './TypeCheckDisablers.js'

export type { EmbeddedFormatEntry, EntryForFormat, FormatClaim, FormatEntry, FormatRegistry, ScriptFormatEntry }

const scriptAstError = (ast: Ast): InstrumentError =>
  InstrumentError.make({
    message: `Expected a script AST, received the "${ast.format}" format`,
    cause: undefined,
  })

const scriptAstOf = (ast: Ast): Option.Option<ScriptAst> =>
  Match.value(ast).pipe(
    Match.when({ format: 'embedded' }, () => Option.none<ScriptAst>()),
    Match.orElse((script) => Option.some(script)),
  )

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  return dot > slash ? fileName.slice(dot).toLowerCase() : ''
}

const CORE_OWNER = '@systemfsoftware/stryker-js-instrumenter'
const CORE_OWNER_VERSION = 'builtin'

const formatRegistry = (entries: readonly FormatEntry[]): FormatRegistry => {
  const entryForFormat = (formatId: string): Option.Option<FormatEntry> =>
    Option.fromUndefinedOr(entries.find((entry) => entry.claim.formatId === formatId))
  const entryForExtension = (extension: string): Option.Option<FormatEntry> =>
    Option.fromUndefinedOr(entries.find((entry) => entry.claim.extensions.includes(extension)))
  return {
    entries,
    entryForFormat,
    entryForExtension,
  }
}

const registerEntriesDataFirst = (registry: FormatRegistry, additions: readonly FormatEntry[]): FormatRegistry =>
  formatRegistry([...registry.entries, ...additions])

export const registerEntries: {
  (registry: FormatRegistry, additions: readonly FormatEntry[]): FormatRegistry
  (additions: readonly FormatEntry[]): (registry: FormatRegistry) => FormatRegistry
} = dual((args: IArguments): boolean => args.length >= 2, registerEntriesDataFirst)

const parseWithEntryDataFirst = (
  entry: FormatEntry,
  file: { readonly name: string; readonly content: string },
): Effect.Effect<Ast, InstrumentError> =>
  entry.parse(file.content, file.name, createParser()).pipe(
    Effect.catchTag('ParseFailed', (cause) => Effect.fail(InstrumentError.make({ message: cause.message, cause }))),
  )

export const parseWithEntry: {
  (entry: FormatEntry, file: { readonly name: string; readonly content: string }): Effect.Effect<Ast, InstrumentError>
  (
    file: { readonly name: string; readonly content: string },
  ): (entry: FormatEntry) => Effect.Effect<Ast, InstrumentError>
} = dual((args: IArguments): boolean => args.length >= 2, parseWithEntryDataFirst)

const resolutionCommandOfDataFirst = (
  registry: FormatRegistry,
  fileName: string,
  formatIdOverride?: string,
): FormatResolutionCommand =>
  FormatResolutionCommand.make({
    fileName,
    extension: extensionOf(fileName),
    formatId: formatIdOverride,
    claims: registry.entries.map((entry) => entry.claim),
  })

export const resolutionCommandOf: {
  (registry: FormatRegistry, fileName: string, formatIdOverride?: string): FormatResolutionCommand
  (fileName: string, formatIdOverride?: string): (registry: FormatRegistry) => FormatResolutionCommand
} = dual((args: IArguments): boolean => typeof args[0] !== 'string', resolutionCommandOfDataFirst)

const scriptHooks = (
  scriptFormat: ScriptFormat,
): Pick<ScriptFormatEntry, 'parse' | 'transform' | 'print' | 'disableTypeChecks'> => ({
  parse: (text, fileName, _context) => parseScriptFormat(scriptFormat, text, fileName),
  transform: (ast, mutantCollector, context) =>
    Option.match(scriptAstOf(ast), {
      onNone: () => Effect.fail(scriptAstError(ast)),
      onSome: (script) => transformScript(script, mutantCollector, context),
    }),
  print: (ast, context) => printScriptAst(ast, context),
  disableTypeChecks: (ast) =>
    Option.match(scriptAstOf(ast), {
      onNone: () => Effect.fail(scriptAstError(ast)),
      onSome: (script) => Effect.succeed(disableTypeCheckingInScript(script)),
    }),
})

const parseScriptFormat = (
  scriptFormat: ScriptFormat,
  text: string,
  fileName: string,
): Effect.Effect<Ast, ParseFailed | InstrumentError> =>
  Match.value(scriptFormat).pipe(
    Match.when('js', () => parseJS(text, fileName)),
    Match.when('ts', () => parseTS(text, fileName)),
    Match.when('tsx', () => parseTsx(text, fileName)),
    Match.exhaustive,
  )

const printScriptAst = (ast: Ast, context: PrinterContext): string =>
  Match.value(ast).pipe(
    Match.when({ format: 'js' }, (js) => jsPrint(js, context)),
    Match.when({ format: 'ts' }, (ts) => tsPrint(ts, context)),
    Match.when({ format: 'tsx' }, (tsx) => tsPrint(tsx, context)),
    Match.orElse(printNothingForEmbeddedAst),
  )

const printNothingForEmbeddedAst = (): string => ''

const SCRIPT_ENTRIES: readonly ScriptFormatEntry[] = [
  {
    claim: { formatId: 'js', extensions: ['.js', '.jsx', '.mjs', '.cjs'], language: 'javascript', kind: 'script' },
    scriptFormat: 'js',
    owner: CORE_OWNER,
    ownerVersion: CORE_OWNER_VERSION,
    ...scriptHooks('js'),
  },
  {
    claim: { formatId: 'ts', extensions: ['.ts', '.mts', '.cts'], language: 'typescript', kind: 'script' },
    scriptFormat: 'ts',
    owner: CORE_OWNER,
    ownerVersion: CORE_OWNER_VERSION,
    ...scriptHooks('ts'),
  },
  {
    claim: { formatId: 'tsx', extensions: ['.tsx'], language: 'typescript', kind: 'script' },
    scriptFormat: 'tsx',
    owner: CORE_OWNER,
    ownerVersion: CORE_OWNER_VERSION,
    ...scriptHooks('tsx'),
  },
]

export const coreFormatRegistry: FormatRegistry = formatRegistry(SCRIPT_ENTRIES)

const resolveFileDataFirst = (registry: FormatRegistry, fileName: string, formatIdOverride?: string) =>
  resolveFormat(resolutionCommandOf(registry, fileName, formatIdOverride))

export const resolveFile: {
  (registry: FormatRegistry, fileName: string, formatIdOverride?: string): ReturnType<typeof resolveFileDataFirst>
  (fileName: string, formatIdOverride?: string): (registry: FormatRegistry) => ReturnType<typeof resolveFileDataFirst>
} = dual((args: IArguments): boolean => typeof args[0] !== 'string', resolveFileDataFirst)

export type FileOutcome =
  | { readonly kind: 'parsed'; readonly parsed: ParsedFile }
  | { readonly kind: 'skipped'; readonly record: InstrumentFileSkip }

type InstrumentedFile = typeof FileSchema.Type

export interface ParsedFile {
  readonly file: InstrumentedFile
  readonly ast: Ast
}

const NO_OPT_IN_MUTATIONS: readonly string[] = []

export const optInMutationsOf = (options: InstrumenterOptions): readonly string[] =>
  options.optInMutations ?? NO_OPT_IN_MUTATIONS

const isIgnorer = (value: unknown): value is Ignorer =>
  Predicate.isObject(value) && typeof value['shouldIgnore'] === 'function'

export const toTransformerOptions = (options: InstrumenterOptions): TransformerOptions => ({
  excludedMutations: [...options.excludedMutations],
  optInMutations: [...optInMutationsOf(options)],
  ignorers: options.ignorers.filter(isIgnorer),
  ...(options.noHeader !== undefined ? { noHeader: options.noHeader } : {}),
})

const missingEntryError = (formatId: string, file: InstrumentedFile): InstrumentError =>
  InstrumentError.make({
    message: `No registered format entry renders "${formatId}", claimed for ${file.name}`,
    cause: new Error(`Missing format entry for "${formatId}"`),
  })

const parsedOutcomeFor = (
  registry: FormatRegistry,
  file: InstrumentedFile,
  assigned: FormatAssigned,
): Effect.Effect<FileOutcome, InstrumentError> =>
  Option.match(registry.entryForFormat(assigned.formatId), {
    onNone: () => Effect.fail(missingEntryError(assigned.formatId, file)),
    onSome: (entry) =>
      Effect.map(parseWithEntry(entry, file), (ast): FileOutcome => ({ kind: 'parsed', parsed: { file, ast } })),
  })

const skippedOutcomeFor = (file: InstrumentedFile, skipped: FormatSkipped): FileOutcome => ({
  kind: 'skipped',
  record: InstrumentFileSkip.make({ file: file.name, extension: skipped.extension, reason: skipped.reason }),
})

const unclaimedOverrideError = (file: InstrumentedFile): InstrumentError =>
  InstrumentError.make({
    message: `No installed format owns ${file.name}`,
    cause: new Error(`Unresolvable format pin for ${file.name}`),
  })

const outcomeFor = (
  registry: FormatRegistry,
  file: InstrumentedFile,
  decision: FormatResolutionDecision,
): Effect.Effect<FileOutcome, InstrumentError> =>
  Match.value(decision).pipe(
    Match.when(S.is(FormatAssigned), (assigned) => parsedOutcomeFor(registry, file, assigned)),
    Match.when(S.is(FormatSkipped), (skipped) => Effect.succeed(skippedOutcomeFor(file, skipped))),
    Match.exhaustive,
  )

export const fileOutcome = (request: {
  readonly registry: FormatRegistry
  readonly file: InstrumentedFile
}): Effect.Effect<FileOutcome, InstrumentError> =>
  Match.value(resolveFile(request.registry, request.file.name)).pipe(
    Match.when(Result.isSuccess, (resolved) => outcomeFor(request.registry, request.file, resolved.success)),
    Match.orElse(() => Effect.fail(unclaimedOverrideError(request.file))),
  )

export const isParsedOutcome = (outcome: FileOutcome): outcome is Extract<FileOutcome, { kind: 'parsed' }> =>
  outcome.kind === 'parsed'

export const skipsOf = (outcome: FileOutcome): readonly InstrumentFileSkip[] =>
  outcome.kind === 'skipped' ? [outcome.record] : []

export const transformInto = (request: {
  readonly registry: FormatRegistry
  readonly collector: MutantCollector
  readonly file: InstrumentedFile
  readonly ast: Ast
  readonly options: InstrumenterOptions
}): Effect.Effect<void, InstrumentError> =>
  transform(request.ast, request.collector, {
    options: toTransformerOptions(request.options),
    mutateDescription: request.file.mutate,
    registry: request.registry,
  }).pipe(
    Effect.mapError((cause) => InstrumentError.make({ message: `Failed to transform ${request.file.name}`, cause })),
  )

export const collectMutants = (collector: MutantCollector): Effect.Effect<readonly ApiMutant[], InstrumentError> =>
  Effect.flatMap(
    Effect.sync(() => Result.all(collector.map(toApiMutant))),
    (collected) =>
      Result.isSuccess(collected)
        ? Effect.succeed(collected.success)
        : Effect.fail(InstrumentError.make({ message: 'Failed to instrument', cause: collected.failure })),
  )

const isScriptEntry = (entry: FormatEntry): entry is ScriptFormatEntry => entry.claim.kind === 'script'

const lacksTsDirective = (file: InstrumentedFile): boolean => !tsDirectiveLikeRegEx.test(file.content)

const prefixesScriptWithoutParsing = (file: InstrumentedFile, entry: ScriptFormatEntry): boolean =>
  entry.scriptFormat !== 'tsx' && lacksTsDirective(file)

const prefixesWithoutParsing = (file: InstrumentedFile, entry: FormatEntry): boolean =>
  Match.value(entry).pipe(
    Match.when(isScriptEntry, (scriptEntry) => prefixesScriptWithoutParsing(file, scriptEntry)),
    Match.orElse(() => false),
  )

const disabledFile = (
  file: InstrumentedFile,
  entry: FormatEntry,
  ast: Ast,
): Effect.Effect<InstrumentedFile, InstrumentError> =>
  Effect.map(entry.disableTypeChecks(ast), (content): InstrumentedFile => ({ ...file, content }))

const parsedEntryFor = (
  file: InstrumentedFile,
  entry: FormatEntry,
): Effect.Effect<InstrumentedFile, InstrumentError> =>
  Effect.flatMap(parseWithEntry(entry, file), (ast) => disabledFile(file, entry, ast))

const spliceFileFor = (
  file: InstrumentedFile,
  entry: FormatEntry,
): Effect.Effect<InstrumentedFile, InstrumentError> =>
  Predicate.isTruthy(prefixesWithoutParsing(file, entry))
    ? Effect.succeed<InstrumentedFile>({ ...file, content: prefixWithNoCheck(file.content) })
    : parsedEntryFor(file, entry)

export const spliceForAssigned = (request: {
  readonly file: InstrumentedFile
  readonly registry: FormatRegistry
  readonly formatId: string
}): Effect.Effect<InstrumentedFile, InstrumentError> =>
  Option.match(request.registry.entryForFormat(request.formatId), {
    onNone: () => Effect.succeed(request.file),
    onSome: (entry) => spliceFileFor(request.file, entry),
  })
