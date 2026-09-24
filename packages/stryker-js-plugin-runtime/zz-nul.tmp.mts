import { readFileSync } from 'node:fs'
import * as S from 'effect/Schema'

import { Options } from '@systemfsoftware/stryker-js-plugin-interface'

const { first } = JSON.parse(readFileSync('/tmp/refactor/probe-pair.json', 'utf8')) as { first: string }
const parsed = JSON.parse(first) as { commandRunner: Record<string, unknown> }
const codes = (record: Record<string, unknown>) => Object.keys(record).map((key) => [...key].map((c) => c.codePointAt(0)))
const Wire = S.fromJsonString(Options.StrykerOptionsSchema)
const decoded = S.decodeUnknownSync(Wire)(first) as unknown as { commandRunner: Record<string, unknown> }
const Runner = S.fromJsonString(Options.CommandRunnerOptionsSchema)
const runnerDecoded = S.decodeUnknownSync(Runner)(JSON.stringify(parsed.commandRunner)) as Record<string, unknown>
const rest = S.decodeUnknownSync(S.fromJsonString(S.Record(S.String, S.Unknown)))(JSON.stringify(parsed.commandRunner)) as Record<string, unknown>
export const report = {
  parsed: codes(parsed.commandRunner),
  wire: codes(decoded.commandRunner),
  runner: codes(runnerDecoded),
  plainRecord: codes(rest),
}

const reencoded = S.encodeSync(Wire)(decoded as never)
const reparsed = JSON.parse(reencoded) as { commandRunner: Record<string, unknown> }
const runnerOnly = S.encodeSync(Runner)(runnerDecoded as never)
const recordOnly = S.encodeSync(S.fromJsonString(S.Record(S.String, S.Unknown)))(rest)
export const encodeReport = {
  wire: codes(reparsed.commandRunner),
  runner: codes(JSON.parse(runnerOnly) as Record<string, unknown>),
  record: codes(JSON.parse(recordOnly) as Record<string, unknown>),
}
