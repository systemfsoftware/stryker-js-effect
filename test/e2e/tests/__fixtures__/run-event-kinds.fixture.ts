import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Schema from 'effect/Schema'

export const RUN_EVENT_KINDS: ReadonlyArray<string> = Schema.toTaggedUnion('_tag')(RunEvent.RunEvent).discriminants

export const TERMINAL_RUN_KINDS: ReadonlyArray<string> = ['verdict', 'error', 'help', 'refused']

export const NON_TERMINAL_RUN_KINDS: ReadonlyArray<string> = RUN_EVENT_KINDS.filter(
  (kind) => !TERMINAL_RUN_KINDS.includes(kind),
)
