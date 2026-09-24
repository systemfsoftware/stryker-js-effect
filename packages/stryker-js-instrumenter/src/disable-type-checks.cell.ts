import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { FormatEntry, FormatRegistry, ScriptFormatEntry } from './format-registry.js'
import { parseWithEntry, resolutionCommandOf } from './format-registry.js'
import { type FileSchema, InstrumentError } from './Instrument.schema.js'
import {
  FormatAssigned,
  type FormatOverrideUnclaimed,
  type FormatResolutionCommand,
  type FormatResolutionDecision,
  resolveFormat,
} from './resolve-format.workflow.js'
import type { Ast } from './Syntax.js'
import { prefixWithNoCheck, tsDirectiveLikeRegEx } from './type-check-disablers.js'

export interface DisableTypeChecksInput {
  readonly file: typeof FileSchema.Type
  readonly registry: FormatRegistry
}

interface DisableTypeChecksRaw {
  readonly file: typeof FileSchema.Type
  readonly registry: FormatRegistry
  readonly command: FormatResolutionCommand
  readonly ast: Ast | undefined
}

const isScriptEntry = (entry: FormatEntry): entry is ScriptFormatEntry => entry.claim.kind === 'script'

const needsJsOrTsPrefix = (entry: ScriptFormatEntry): boolean => entry.scriptFormat !== 'tsx'

const lacksTsDirective = (file: typeof FileSchema.Type): boolean => !tsDirectiveLikeRegEx.test(file.content)

const prefixesWithoutParsing = (file: typeof FileSchema.Type, entry: FormatEntry): boolean =>
  isScriptEntry(entry) && scriptEntryPrefixesWithoutParsing(file, entry)

const scriptEntryPrefixesWithoutParsing = (file: typeof FileSchema.Type, entry: ScriptFormatEntry): boolean =>
  needsJsOrTsPrefix(entry) && lacksTsDirective(file)

const parseAssignedFormat = (
  input: DisableTypeChecksInput,
  assigned: FormatAssigned,
): Effect.Effect<Ast | undefined, InstrumentError> =>
  Option.match(input.registry.entryForFormat(assigned.formatId), {
    onNone: (): Effect.Effect<Ast | undefined, InstrumentError> => Effect.succeed(absentAst()),
    onSome: (entry) => parseClaimedEntry(input, entry),
  })

const absentAst = (): Ast | undefined => undefined

const parseClaimedEntry = (
  input: DisableTypeChecksInput,
  entry: FormatEntry,
): Effect.Effect<Ast | undefined, InstrumentError> =>
  prefixesWithoutParsing(input.file, entry)
    ? Effect.succeed(absentAst())
    : Effect.map(parseWithEntry(entry, input.file), (ast): Ast | undefined => ast)
const readDisable = (input: DisableTypeChecksInput): Effect.Effect<DisableTypeChecksRaw, InstrumentError> =>
  Effect.gen(function*() {
    const command = resolutionCommandOf(input.registry, input.file.name)
    const ast = yield* parseClaimed(input, command)
    return { file: input.file, registry: input.registry, command, ast }
  })

const parseClaimed = (
  input: DisableTypeChecksInput,
  command: FormatResolutionCommand,
): Effect.Effect<Ast | undefined, InstrumentError> => {
  const decision = Option.getOrUndefined(Result.getSuccess(resolveFormat(command)))
  return isAssignedDecision(decision) ? parseAssignedFormat(input, decision) : Effect.succeed(absentAst())
}

const isAssignedDecision = (decision: FormatResolutionDecision | undefined): decision is FormatAssigned =>
  decision !== undefined && S.is(FormatAssigned)(decision)
const spliceFile = (
  raw: DisableTypeChecksRaw,
  entry: FormatEntry,
): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
  Match.value(raw.ast).pipe(
    Match.when(Predicate.isNotNullish, (ast) =>
      Effect.map(
        entry.disableTypeChecks(ast),
        (content): typeof FileSchema.Type => ({ ...raw.file, content }),
      )),
    Match.orElse(() =>
      Effect.succeed<typeof FileSchema.Type>({ ...raw.file, content: prefixWithNoCheck(raw.file.content) })
    ),
  )
const spliceOutcome = (
  raw: DisableTypeChecksRaw,
  decision: FormatResolutionDecision,
): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
  Match.value(decision).pipe(
    Match.when(S.is(FormatAssigned), (assigned) =>
      Option.match(raw.registry.entryForFormat(assigned.formatId), {
        onNone: () => Effect.succeed(raw.file),
        onSome: (entry) => spliceFile(raw, entry),
      })),
    Match.orElse(() => Effect.succeed(raw.file)),
  )

const writeDisable = (
  output: Result.Result<FormatResolutionDecision, FormatOverrideUnclaimed>,
  raw: DisableTypeChecksRaw,
): Effect.Effect<typeof FileSchema.Type, FormatOverrideUnclaimed | InstrumentError> =>
  Result.isFailure(output) ? Effect.fail(output.failure) : spliceOutcome(raw, output.success)

export const disableTypeChecksCell: Cell.Cell<
  DisableTypeChecksInput,
  typeof FileSchema.Type,
  InstrumentError | FormatOverrideUnclaimed,
  never
> = Sandwich.read(readDisable)
  .decode(
    Sandwich.pure((raw: DisableTypeChecksRaw): Result.Result<FormatResolutionCommand, never> =>
      Result.succeed(raw.command)
    ),
  )
  .decide(resolveFormat)
  .encode(Sandwich.pure((outcome) => Result.succeed(outcome)))
  .write(writeDisable)
