import { decodeStream as decodeStreamWorkflow, DecodeStreamCommand } from '@systemfsoftware/stryker-e2e-core'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Effect, Option, Result, Schema } from 'effect'

const TERMINAL_PREVIEW_CHARS = 4_000

export class MachineStreamError extends Schema.TaggedError<MachineStreamError>()('MachineStreamError', {
  line: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `machine stream: ${this.detail}\n${this.line}`
  }
}

export const decodeStream = (
  stdout: string,
): Effect.Effect<ReadonlyArray<RunEvent.RunEvent>, MachineStreamError> =>
  Result.match(decodeStreamWorkflow(DecodeStreamCommand.make({ lines: stdout.split('\n') })), {
    onFailure: (refused) =>
      Effect.fail(
        new MachineStreamError({ line: refused.line, detail: `line ${refused.lineNumber}: ${refused.reason}` }),
      ),
    onSuccess: (decoded) => Effect.succeed(decoded.events),
  })

export const terminalEvent = (
  events: ReadonlyArray<RunEvent.RunEvent>,
): Effect.Effect<RunEvent.RunEvent, MachineStreamError> =>
  Option.match(Option.fromNullishOr(events.at(-1)), {
    onNone: () => Effect.fail(new MachineStreamError({ line: '', detail: 'stdout carries no events' })),
    onSome: (event) => Effect.succeed(event),
  })

export type VerdictEvent = Extract<RunEvent.RunEvent, { readonly _tag: 'verdict' }>

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

export const reuseEventOf = (
  events: ReadonlyArray<RunEvent.RunEvent>,
): Effect.Effect<RunEvent.ReuseReported, MachineStreamError> =>
  Option.match(Option.fromUndefinedOr(events.find(Schema.is(RunEvent.ReuseReported))), {
    onNone: () => Effect.fail(new MachineStreamError({ line: '', detail: 'the run emitted no reuse event' })),
    onSome: (reuse) => Effect.succeed(reuse),
  })
