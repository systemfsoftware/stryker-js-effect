import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

import { RunEvent } from './RunEvent.schema.js'

export const RunEventWireLine = S.String.pipe(
  S.decodeTo(S.fromJsonString(RunEvent), {
    decode: SchemaGetter.transform((line: string): string => line.replace(/\n$/, '')),
    encode: SchemaGetter.transform((json: string): string => `${json}\n`),
  }),
)

export type RunEventWireLine = typeof RunEventWireLine.Type
