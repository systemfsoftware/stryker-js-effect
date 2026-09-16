import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { FormatEntry, FormatRegistry, ScriptFormatEntry } from './format-registry.js'
import { type FileSchema, InstrumentError } from './Instrument.schema.js'
import { createParser } from './Parser.js'
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

const isJsOrTsScriptEntry = (entry: FormatEntry): boolean => isScriptEntry(entry) && entry.scriptFormat !== 'tsx'

const prefixesWithoutParsing = (file: typeof FileSchema.Type, entry: FormatEntry): boolean =>
  isJsOrTsScriptEntry(entry) && !tsDirectiveLikeRegEx.test(file.content)

const parseThrough = (
  input: DisableTypeChecksInput,
  entry: FormatEntry,
): Effect.Effect<Ast | undefined, InstrumentError> =>
  Effect.tryPromise({
    try: () => entry.parse(input.file.content, input.file.name, { parse: createParser(input.registry) }),
    catch: (cause) => new InstrumentError({ message: `Failed to parse ${input.file.name}`, cause }),
  })

const parseWhenResolved = (
  input: DisableTypeChecksInput,
  decision: FormatResolutionDecision,
): Effect.Effect<Ast | undefined, InstrumentError> =>
  Match.value(decision).pipe(
    Match.when(S.is(FormatAssigned), (assigned) =>
      Option.match(input.registry.entryForFormat(assigned.formatId), {
        onNone: () => Effect.succeed<Ast | undefined>(undefined),
        onSome: (entry) =>
          prefixesWithoutParsing(input.file, entry)
            ? Effect.succeed<Ast | undefined>(undefined)
            : parseThrough(input, entry),
      })),
    Match.orElse(() => Effect.succeed<Ast | undefined>(undefined)),
  )

const parseWhenClaimed = (
  input: DisableTypeChecksInput,
  command: FormatResolutionCommand,
): Effect.Effect<Ast | undefined, InstrumentError> =>
  Match.value(resolveFormat(command)).pipe(
    Match.when(Result.isSuccess, (resolved) => parseWhenResolved(input, resolved.success)),
    Match.orElse(() => Effect.succeed<Ast | undefined>(undefined)),
  )

const readDisable = (input: DisableTypeChecksInput): Effect.Effect<DisableTypeChecksRaw, InstrumentError> =>
  Effect.gen(function*() {
    const command = input.registry.resolutionCommand(input.file.name)
    const ast = yield* parseWhenClaimed(input, command)
    return { file: input.file, registry: input.registry, command, ast }
  })

const spliceFile = (raw: DisableTypeChecksRaw, entry: FormatEntry): typeof FileSchema.Type =>
  Match.value(raw.ast).pipe(
    Match.when(Predicate.isNotNullish, (ast) => ({ ...raw.file, content: entry.disableTypeChecks(ast) })),
    Match.orElse(() => ({ ...raw.file, content: prefixWithNoCheck(raw.file.content) })),
  )

const spliceOutcome = (
  raw: DisableTypeChecksRaw,
  decision: FormatResolutionDecision,
): Effect.Effect<typeof FileSchema.Type, never> =>
  Match.value(decision).pipe(
    Match.when(S.is(FormatAssigned), (assigned) =>
      Option.match(raw.registry.entryForFormat(assigned.formatId), {
        onNone: () => Effect.succeed(raw.file),
        onSome: (entry) => Effect.succeed(spliceFile(raw, entry)),
      })),
    Match.orElse(() => Effect.succeed(raw.file)),
  )

const writeDisable = (
  output: Result.Result<FormatResolutionDecision, FormatOverrideUnclaimed>,
  raw: DisableTypeChecksRaw,
): Effect.Effect<typeof FileSchema.Type, FormatOverrideUnclaimed> =>
  Effect.gen(function*() {
    if (Result.isFailure(output)) {
      return yield* Effect.fail(output.failure)
    }
    return yield* spliceOutcome(raw, output.success)
  })

export const disableTypeChecksCell = Cell.layer({
  read: readDisable,
  decode: (raw: DisableTypeChecksRaw): Result.Result<FormatResolutionCommand, never> => Result.succeed(raw.command),
  decide: resolveFormat,
  encode: (outcome) => outcome,
  write: writeDisable,
})
