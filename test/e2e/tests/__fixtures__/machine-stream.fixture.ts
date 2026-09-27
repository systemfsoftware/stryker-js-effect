import { RunEvent } from '@systemfsoftware/stryker-js'
import { Effect, Option, Schema } from 'effect'

const TERMINAL_PREVIEW_CHARS = 4_000

export class MachineStreamError extends Schema.TaggedError<MachineStreamError>()('MachineStreamError', {
  line: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `machine stream: ${this.detail}\n${this.line}`
  }
}

const isEventLine = (line: string): boolean => line.startsWith('{') && line.endsWith('}')

const eventLinesOf = (stdout: string): ReadonlyArray<string> =>
  stdout.split('\n').map((line) => line.trim()).filter(isEventLine)

export const decodeStream = (
  stdout: string,
): Effect.Effect<ReadonlyArray<RunEvent.RunEvent>, MachineStreamError> =>
  Effect.forEach(
    eventLinesOf(stdout),
    (line) =>
      Effect.mapError(
        Schema.decodeUnknownEffect(RunEvent.RunEventWireLine)(line),
        (issue) => new MachineStreamError({ line, detail: `stdout line is not a RunEvent: ${issue.message}` }),
      ),
  )

export const terminalEvent = (
  events: ReadonlyArray<RunEvent.RunEvent>,
): Effect.Effect<RunEvent.RunEvent, MachineStreamError> =>
  Option.match(Option.fromNullishOr(events.at(-1)), {
    onNone: () => Effect.fail(new MachineStreamError({ line: '', detail: 'stdout carries no events' })),
    onSome: (event) => Effect.succeed(event),
  })

export type VerdictEvent = Extract<RunEvent.RunEvent, { readonly _tag: 'verdict' }>

export const verdictOrUndefined = (events: ReadonlyArray<RunEvent.RunEvent>): VerdictEvent | undefined => {
  const terminal = events.at(-1)
  return terminal !== undefined && terminal._tag === 'verdict' ? terminal : undefined
}

export const reportedMutantsOf = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .filter((event): event is Extract<RunEvent.RunEvent, { _tag: 'mutantTested' }> => event._tag === 'mutantTested')
    .map((mutant) => `${mutant.mutatorName}:${mutant.status}`)

export const runIdsIn = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<string> =>
  events
    .map((event) => ('runId' in event && typeof event.runId === 'string' ? String(event.runId) : undefined))
    .filter((runId): runId is string => runId !== undefined)

export const verdictEvent = (
  events: ReadonlyArray<RunEvent.RunEvent>,
): Effect.Effect<VerdictEvent, MachineStreamError> =>
  Effect.flatMap(terminalEvent(events), (terminal) =>
    terminal._tag === 'verdict'
      ? Effect.succeed(terminal)
      : Effect.fail(
        new MachineStreamError({
          line: JSON.stringify(terminal).slice(0, TERMINAL_PREVIEW_CHARS),
          detail: `expected terminal verdict event, received: ${terminal._tag}`,
        }),
      ))
