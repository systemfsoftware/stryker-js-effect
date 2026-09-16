import type { StrykerOptions } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'

type WorkerOptionsWire = S.Codec<StrykerOptions, string>

let wire: WorkerOptionsWire | undefined

const workerOptionsWire = (): WorkerOptionsWire => wire ??= S.fromJsonString(S.toCodecJson(StrykerOptionsSchema))

export const encodeWorkerOptions = (options: StrykerOptions): Effect.Effect<string> =>
  S.encodeEffect(workerOptionsWire())(options).pipe(Effect.orDie)

export const decodeWorkerOptions = (raw: string) => S.decodeUnknownEffect(workerOptionsWire())(raw)
