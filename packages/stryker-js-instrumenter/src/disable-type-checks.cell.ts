import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import type { Ast } from './Ast.schema.js'
import { parseWithEntry, resolutionCommandOf } from './Format.handle.js'
import type { FormatEntry, FormatRegistry, ScriptFormatEntry } from './Format.schema.js'
import { type FileSchema, InstrumentError } from './Instrument.schema.js'
import {
  type FormatOverrideUnclaimed,
  FormatOverrideUnclaimed as FormatOverrideUnclaimedError,
  type FormatResolutionCommand,
  resolveFormat,
} from './resolve-format.workflow.js'
import { prefixWithNoCheck, tsDirectiveLikeRegEx } from './TypeCheckDisablers.handle.js'

export interface DisableTypeChecksInput {
  readonly file: typeof FileSchema.Type
  readonly registry: FormatRegistry
}

type DisableTypeChecksRaw = typeof FormatResolutionCommand.Encoded & {
  readonly version: 'disable-type-checks'
  readonly file: typeof FileSchema.Type
  readonly registry: FormatRegistry
}

const isScriptEntry = (entry: FormatEntry): entry is ScriptFormatEntry => entry.claim.kind === 'script'

const lacksTsDirective = (file: typeof FileSchema.Type): boolean => !tsDirectiveLikeRegEx.test(file.content)

const prefixesWithoutParsing = (file: typeof FileSchema.Type, entry: FormatEntry): boolean =>
  Match.value(entry).pipe(
    Match.when(isScriptEntry, (scriptEntry) => prefixesScriptWithoutParsing(file, scriptEntry)),
    Match.orElse(() => false),
  )

const prefixesScriptWithoutParsing = (file: typeof FileSchema.Type, entry: ScriptFormatEntry): boolean =>
  Match.value(entry.scriptFormat === 'tsx').pipe(
    Match.when(true, () => false),
    Match.when(false, () => lacksTsDirective(file)),
    Match.exhaustive,
  )

const readDisable = (input: DisableTypeChecksInput): Effect.Effect<DisableTypeChecksRaw, never> =>
  Effect.sync(() => {
    const command = resolutionCommandOf(input.registry, input.file.name)
    return {
      _tag: 'FormatResolutionCommand',
      fileName: command.fileName,
      extension: command.extension,
      formatId: command.formatId,
      claims: command.claims,
      version: 'disable-type-checks',
      file: input.file,
      registry: input.registry,
    }
  })

const disabledFile = (
  raw: DisableTypeChecksRaw,
  entry: FormatEntry,
  ast: Ast,
): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
  Effect.map(entry.disableTypeChecks(ast), (content): typeof FileSchema.Type => ({ ...raw.file, content }))

const parsedEntry = (
  raw: DisableTypeChecksRaw,
  entry: FormatEntry,
): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
  Effect.flatMap(parseWithEntry(entry, raw.file), (ast) => disabledFile(raw, entry, ast))

const spliceFile = (
  raw: DisableTypeChecksRaw,
  entry: FormatEntry,
): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
  Predicate.isTruthy(prefixesWithoutParsing(raw.file, entry))
    ? Effect.succeed<typeof FileSchema.Type>({ ...raw.file, content: prefixWithNoCheck(raw.file.content) })
    : parsedEntry(raw, entry)

const spliceAssigned = (
  raw: DisableTypeChecksRaw,
  assigned: { readonly formatId: string },
): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
  Option.match(raw.registry.entryForFormat(assigned.formatId), {
    onNone: () => Effect.succeed(raw.file),
    onSome: (entry) => spliceFile(raw, entry),
  })

const unchanged = (raw: DisableTypeChecksRaw): Effect.Effect<typeof FileSchema.Type, never> => Effect.succeed(raw.file)

export const disableTypeChecksCell: Cell.Cell<
  DisableTypeChecksInput,
  typeof FileSchema.Type,
  InstrumentError | FormatOverrideUnclaimed,
  never
> = Sandwich.named('stryker.instrument.disableTypeChecks')(
  (input: DisableTypeChecksInput) => readDisable(input),
)
  .decide(resolveFormat)
  .write({
    FormatAssigned: (assigned, raw): Effect.Effect<typeof FileSchema.Type, InstrumentError> =>
      spliceAssigned(raw, assigned),
    FormatSkipped: (_skipped, raw) => unchanged(raw),
    FormatOverrideUnclaimed: (failure) => Effect.fail(FormatOverrideUnclaimedError.make(failure)),
    CommandRejected: ({ issue }) => Effect.fail(InstrumentError.make({ message: issue, cause: new Error(issue) })),
  })
